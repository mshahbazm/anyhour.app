<?php
/**
 * Asks your AI to re-read this website when its content changes.
 *
 * @package Anyhour
 */

namespace Anyhour;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Your AI learns this site by crawling it, and re-reads it on its own
 * schedule. With an API key, the plugin can ask for a re-read sooner: on
 * demand, and an hour after posts or pages change (one request per hour at
 * most, however many edits are made).
 *
 * It uses the workspace API key on these existing API routes:
 * - GET  /api/v1/me                                    (which workspace)
 * - GET  /api/organizations/:org/business/sources      (find this site)
 * - POST /api/organizations/:org/business/sources      (add it as a website)
 * - POST /api/organizations/:org/business/sources/:sourceId/runs (re-read it)
 */
final class Sync {

	const HOOK = 'anyhour_sync';
	const LOCK = 'anyhour_sync_lock';

	/**
	 * Hook into publishing and WP-Cron.
	 */
	public static function register() {
		add_action( 'transition_post_status', array( __CLASS__, 'content_changed' ), 10, 3 );
		add_action( self::HOOK, array( __CLASS__, 'run_scheduled' ) );
	}

	/**
	 * Whether sync can run: an AI id and an API key are both saved.
	 *
	 * @return bool
	 */
	public static function available() {
		return '' !== Options::assistant_id() && '' !== Options::api_key();
	}

	/**
	 * A post was published, updated while published, or unpublished.
	 *
	 * @param string   $new_status The post's new status.
	 * @param string   $old_status The post's previous status.
	 * @param \WP_Post $post       The post.
	 */
	public static function content_changed( $new_status, $old_status, $post ) {
		if ( 'publish' !== $new_status && 'publish' !== $old_status ) {
			return;
		}
		if ( ! $post instanceof \WP_Post || wp_is_post_revision( $post ) || wp_is_post_autosave( $post ) ) {
			return;
		}
		if ( ! is_post_type_viewable( $post->post_type ) ) {
			return;
		}
		$settings = Options::settings();
		if ( empty( $settings['auto_sync'] ) || ! self::available() ) {
			return;
		}
		self::schedule();
	}

	/**
	 * Schedule one re-read, unless one is already waiting. That is the debounce:
	 * edits within the hour share the same request.
	 */
	public static function schedule() {
		if ( wp_next_scheduled( self::HOOK ) ) {
			return;
		}
		/**
		 * Filters how long after a change the site is re-read, in seconds.
		 *
		 * @param int $delay Defaults to one hour.
		 */
		$delay = (int) apply_filters( 'anyhour_sync_delay', HOUR_IN_SECONDS );
		wp_schedule_single_event( time() + max( 60, $delay ), self::HOOK );
	}

	/**
	 * Remove any waiting re-read (on deactivation and uninstall).
	 */
	public static function unschedule() {
		wp_clear_scheduled_hook( self::HOOK );
	}

	/**
	 * The WP-Cron entry point.
	 */
	public static function run_scheduled() {
		$settings = Options::settings();
		if ( ! empty( $settings['auto_sync'] ) && self::available() ) {
			self::run();
		}
	}

	/**
	 * Ask your AI to re-read this site now, adding it as a website
	 * first if it isn't one of its sources yet.
	 *
	 * @return array{ok:bool,message:string}
	 */
	public static function run() {
		if ( ! self::available() ) {
			return self::finish( false, __( 'Add your AI’s id and an API key first.', 'anyhour' ) );
		}
		if ( get_transient( self::LOCK ) ) {
			return array(
				'ok'      => false,
				'message' => __( 'A sync is already in progress. Try again in a minute.', 'anyhour' ),
			);
		}
		set_transient( self::LOCK, 1, MINUTE_IN_SECONDS );
		try {
			return self::sync();
		} finally {
			delete_transient( self::LOCK );
		}
	}

	/**
	 * The sync itself.
	 *
	 * @return array{ok:bool,message:string}
	 */
	private static function sync() {
		$organization_id = self::organization_id();
		if ( is_array( $organization_id ) ) {
			return self::finish( false, $organization_id['error'] );
		}
		$base = '/api/organizations/' . rawurlencode( $organization_id ) . '/business/sources';

		// The source found last time, if it still exists.
		$source_id = Options::state()['source_id'];
		if ( '' !== $source_id ) {
			$run = Client::request( 'POST', $base . '/' . rawurlencode( $source_id ) . '/runs' );
			if ( $run['ok'] ) {
				return self::finish( true, __( 'Your AI is re-reading your website.', 'anyhour' ) );
			}
			if ( 404 !== $run['status'] ) {
				return self::finish( false, $run['error'] );
			}
			Options::update_state( array( 'source_id' => '' ) );
		}

		$found = self::find_website( $base );
		if ( is_array( $found ) ) {
			return self::finish( false, $found['error'] );
		}
		if ( '' !== $found ) {
			Options::update_state( array( 'source_id' => $found ) );
			$run = Client::request( 'POST', $base . '/' . rawurlencode( $found ) . '/runs' );
			return $run['ok']
				? self::finish( true, __( 'Your AI is re-reading your website.', 'anyhour' ) )
				: self::finish( false, $run['error'] );
		}

		// Not a source yet: add the whole site. Creating it starts the first read.
		$created = Client::request(
			'POST',
			$base,
			array(
				'kind' => 'website',
				'url'  => home_url( '/' ),
			)
		);
		if ( ! $created['ok'] ) {
			return self::finish( false, $created['error'] );
		}
		if ( isset( $created['body']['source']['id'] ) ) {
			Options::update_state( array( 'source_id' => (string) $created['body']['source']['id'] ) );
		}
		return self::finish( true, __( 'Your website was added to your AI, which is reading it now.', 'anyhour' ) );
	}

	/**
	 * The API key's workspace, cached after the first lookup.
	 *
	 * @return string|array The id, or array{error:string}.
	 */
	private static function organization_id() {
		$cached = Options::state()['organization_id'];
		if ( '' !== $cached ) {
			return $cached;
		}
		$me = Client::request( 'GET', '/api/v1/me' );
		if ( ! $me['ok'] || empty( $me['body']['organizationId'] ) ) {
			return array( 'error' => $me['error'] ? $me['error'] : __( 'Could not read your workspace.', 'anyhour' ) );
		}
		$id = (string) $me['body']['organizationId'];
		Options::update_state( array( 'organization_id' => $id ) );
		return $id;
	}

	/**
	 * Your AI’s website source for this site, or '' when there is none.
	 *
	 * @param string $base The sources path.
	 * @return string|array The source id, '', or array{error:string}.
	 */
	private static function find_website( $base ) {
		$host   = Options::site_host();
		$cursor = '';
		// Sources are listed newest first, 200 at a time, with each crawled page
		// as its own source; the site itself is a top-level "website" source.
		for ( $page = 0; $page < 10; $page++ ) {
			$list = Client::request( 'GET', $base . '?limit=200' . ( $cursor ? '&cursor=' . rawurlencode( $cursor ) : '' ) );
			if ( ! $list['ok'] ) {
				return array( 'error' => $list['error'] );
			}
			foreach ( (array) $list['body'] as $source ) {
				if (
					is_array( $source )
					&& isset( $source['kind'], $source['id'] )
					&& 'website' === $source['kind']
					&& empty( $source['parentId'] )
					&& ! empty( $source['inputUrl'] )
					&& Options::site_host( (string) $source['inputUrl'] ) === $host
				) {
					return (string) $source['id'];
				}
			}
			$cursor = $list['next_cursor'];
			if ( '' === $cursor ) {
				break;
			}
		}
		return '';
	}

	/**
	 * Record how a sync went, for the settings page.
	 *
	 * @param bool   $ok      Whether it worked.
	 * @param string $message What to tell the owner.
	 * @return array{ok:bool,message:string}
	 */
	private static function finish( $ok, $message ) {
		Options::update_state(
			array(
				'last_sync_at' => time(),
				'last_ok'      => $ok,
				'last_message' => $message,
			)
		);
		return array(
			'ok'      => $ok,
			'message' => $message,
		);
	}
}
