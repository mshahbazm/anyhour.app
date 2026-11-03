<?php
/**
 * Settings → Anyhour.
 *
 * @package Anyhour
 */

namespace Anyhour;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The settings page, built on the Settings API, with "Test connection" and
 * "Sync my site now" as nonce-checked admin-post actions.
 */
final class Settings {

	const PAGE   = 'anyhour';
	const GROUP  = 'anyhour';
	const NOTICE = 'anyhour_notice_';

	/**
	 * Hook into the admin.
	 */
	public static function register() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'fields' ) );
		add_action( 'admin_post_anyhour_test', array( __CLASS__, 'handle_test' ) );
		add_action( 'admin_post_anyhour_sync', array( __CLASS__, 'handle_sync' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( ANYHOUR_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * Add the page under Settings.
	 */
	public static function menu() {
		add_options_page(
			__( 'Anyhour', 'anyhour' ),
			__( 'Anyhour', 'anyhour' ),
			'manage_options',
			self::PAGE,
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * A "Settings" link on the Plugins screen.
	 *
	 * @param array $links Existing links.
	 * @return array
	 */
	public static function action_links( $links ) {
		array_unshift(
			$links,
			sprintf(
				'<a href="%s">%s</a>',
				esc_url( admin_url( 'options-general.php?page=' . self::PAGE ) ),
				esc_html__( 'Settings', 'anyhour' )
			)
		);
		return $links;
	}

	/**
	 * Register the option, sections and fields.
	 */
	public static function fields() {
		register_setting(
			self::GROUP,
			Options::SETTINGS,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => Options::defaults(),
				'show_in_rest'      => false,
			)
		);

		add_settings_section( 'anyhour_chat', __( 'Chat on your website', 'anyhour' ), array( __CLASS__, 'chat_intro' ), self::PAGE );
		add_settings_field( 'front_desk_id', __( 'Your AI’s id', 'anyhour' ), array( __CLASS__, 'field_assistant_id' ), self::PAGE, 'anyhour_chat', array( 'label_for' => 'anyhour_assistant_id' ) );
		add_settings_field( 'show_chat', __( 'Show the chat', 'anyhour' ), array( __CLASS__, 'field_show_chat' ), self::PAGE, 'anyhour_chat' );

		add_settings_section( 'anyhour_sync', __( 'Content sync (optional)', 'anyhour' ), array( __CLASS__, 'sync_intro' ), self::PAGE );
		add_settings_field( 'api_key', __( 'API key', 'anyhour' ), array( __CLASS__, 'field_api_key' ), self::PAGE, 'anyhour_sync', array( 'label_for' => 'anyhour_api_key' ) );
		add_settings_field( 'auto_sync', __( 'Re-read after changes', 'anyhour' ), array( __CLASS__, 'field_auto_sync' ), self::PAGE, 'anyhour_sync' );

		add_settings_section( 'anyhour_advanced', __( 'Advanced', 'anyhour' ), array( __CLASS__, 'advanced_intro' ), self::PAGE );
		add_settings_field( 'api_url', __( 'API address', 'anyhour' ), array( __CLASS__, 'field_url' ), self::PAGE, 'anyhour_advanced', array( 'label_for' => 'anyhour_api_url', 'key' => 'api_url', 'constant' => 'ANYHOUR_API_URL', 'default' => ANYHOUR_DEFAULT_API_URL ) );
		add_settings_field( 'widget_url', __( 'Chat script address', 'anyhour' ), array( __CLASS__, 'field_url' ), self::PAGE, 'anyhour_advanced', array( 'label_for' => 'anyhour_widget_url', 'key' => 'widget_url', 'constant' => 'ANYHOUR_WIDGET_URL', 'default' => ANYHOUR_DEFAULT_WIDGET_URL ) );
	}

	/**
	 * Clean what the form sent. The API key is never sent back to the browser,
	 * so an empty key field keeps the saved one.
	 *
	 * @param mixed $input The submitted values.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$old   = Options::settings();
		$input = is_array( $input ) ? wp_unslash( $input ) : array();
		$clean = $old;

		$clean['front_desk_id'] = self::clean_id( isset( $input['front_desk_id'] ) ? (string) $input['front_desk_id'] : '' );
		$clean['show_chat']     = ! empty( $input['show_chat'] );
		$clean['auto_sync']     = ! empty( $input['auto_sync'] );

		$key = isset( $input['api_key'] ) ? trim( (string) $input['api_key'] ) : '';
		if ( ! empty( $input['remove_api_key'] ) ) {
			$clean['api_key'] = '';
		} elseif ( '' !== $key ) {
			if ( preg_match( '/^wp_live_[A-Za-z0-9_-]{43}$/', $key ) ) {
				$clean['api_key'] = $key;
			} else {
				add_settings_error( Options::SETTINGS, 'anyhour_api_key', __( 'That API key doesn’t look right. It starts with wp_live_. The saved key was kept.', 'anyhour' ) );
			}
		}

		foreach ( array( 'api_url', 'widget_url' ) as $field ) {
			$url = isset( $input[ $field ] ) ? esc_url_raw( trim( (string) $input[ $field ] ), array( 'https', 'http' ) ) : '';
			if ( '' !== $url && ! wp_http_validate_url( $url ) && ! preg_match( '#^https?://(localhost|127\.0\.0\.1)(:\d+)?(/|$)#', $url ) ) {
				add_settings_error( Options::SETTINGS, 'anyhour_' . $field, __( 'Enter a full web address, like https://example.com.', 'anyhour' ) );
				$url = $old[ $field ];
			}
			$clean[ $field ] = untrailingslashit( $url );
		}

		if ( $clean['show_chat'] && '' === $clean['front_desk_id'] ) {
			add_settings_error( Options::SETTINGS, 'anyhour_assistant_id', __( 'Add your AI’s id to show the chat.', 'anyhour' ), 'warning' );
		}

		// A different key or AI means a different workspace or source.
		if ( $clean['api_key'] !== $old['api_key'] || $clean['front_desk_id'] !== $old['front_desk_id'] || $clean['api_url'] !== $old['api_url'] ) {
			delete_option( Options::STATE );
		}
		if ( '' === $clean['api_key'] || empty( $clean['auto_sync'] ) ) {
			Sync::unschedule();
		}
		return $clean;
	}

	/**
	 * Keep only id characters. Pasting the whole embed snippet works too.
	 *
	 * @param string $value What the owner pasted.
	 * @return string
	 */
	private static function clean_id( $value ) {
		if ( preg_match( '/data-bot\s*=\s*["\']([^"\']+)["\']/', $value, $match ) ) {
			$value = $match[1];
		}
		return substr( (string) preg_replace( '/[^A-Za-z0-9_-]/', '', $value ), 0, 64 );
	}

	/**
	 * Intro to the chat section.
	 */
	public static function chat_intro() {
		echo '<p>' . esc_html__( 'Find your AI’s id in Anyhour under Install: it is the data-bot value in the embed code. You can paste the whole code here and the id is picked out.', 'anyhour' ) . '</p>';
	}

	/**
	 * Intro to the sync section.
	 */
	public static function sync_intro() {
		echo '<p>' . esc_html__( 'Your AI already reads your website on its own schedule. With an API key it can also re-read it when you publish or update posts and pages (at most once an hour). Create a key in Anyhour under Settings → API keys.', 'anyhour' ) . '</p>';
	}

	/**
	 * Intro to the advanced section.
	 */
	public static function advanced_intro() {
		echo '<p>' . esc_html__( 'Leave these empty unless Anyhour support or your developer gives you different addresses.', 'anyhour' ) . '</p>';
	}

	/**
	 * AI id field.
	 */
	public static function field_assistant_id() {
		printf(
			'<input type="text" class="regular-text code" id="anyhour_assistant_id" name="%s[front_desk_id]" value="%s" autocomplete="off" spellcheck="false" />',
			esc_attr( Options::SETTINGS ),
			esc_attr( Options::assistant_id() )
		);
	}

	/**
	 * Show the chat toggle.
	 */
	public static function field_show_chat() {
		$settings = Options::settings();
		printf(
			'<label><input type="checkbox" name="%s[show_chat]" value="1" %s /> %s</label><p class="description">%s</p>',
			esc_attr( Options::SETTINGS ),
			checked( ! empty( $settings['show_chat'] ), true, false ),
			esc_html__( 'Show the chat on every page of this website', 'anyhour' ),
			esc_html__( 'It loads after your page has, so it won’t slow your website down. Visitors only see it while your AI is live in Anyhour and this website is one of its allowed websites.', 'anyhour' )
		);
	}

	/**
	 * API key field. The saved key is never printed; only its start is shown.
	 */
	public static function field_api_key() {
		$key = Options::api_key();
		printf(
			'<input type="password" class="regular-text code" id="anyhour_api_key" name="%s[api_key]" value="" autocomplete="new-password" spellcheck="false" placeholder="%s" />',
			esc_attr( Options::SETTINGS ),
			esc_attr( $key ? __( 'Saved. Enter a new key to replace it.', 'anyhour' ) : 'wp_live_…' )
		);
		if ( $key ) {
			printf(
				'<p class="description">%s <code>%s…</code></p><label><input type="checkbox" name="%s[remove_api_key]" value="1" /> %s</label>',
				esc_html__( 'Saved key:', 'anyhour' ),
				esc_html( substr( $key, 0, 12 ) ),
				esc_attr( Options::SETTINGS ),
				esc_html__( 'Remove the saved key', 'anyhour' )
			);
		}
	}

	/**
	 * Auto-sync toggle.
	 */
	public static function field_auto_sync() {
		$settings = Options::settings();
		printf(
			'<label><input type="checkbox" name="%s[auto_sync]" value="1" %s /> %s</label>',
			esc_attr( Options::SETTINGS ),
			checked( ! empty( $settings['auto_sync'] ), true, false ),
			esc_html__( 'Ask my AI to re-read the website an hour after I publish or update content', 'anyhour' )
		);
	}

	/**
	 * An address field, locked when wp-config.php sets it.
	 *
	 * @param array $args key, constant, default.
	 */
	public static function field_url( $args ) {
		$settings = Options::settings();
		$locked   = defined( $args['constant'] );
		printf(
			'<input type="url" class="regular-text code" id="%s" name="%s[%s]" value="%s" placeholder="%s" %s />',
			esc_attr( $args['label_for'] ),
			esc_attr( Options::SETTINGS ),
			esc_attr( $args['key'] ),
			esc_attr( $locked ? constant( $args['constant'] ) : $settings[ $args['key'] ] ),
			esc_attr( $args['default'] ),
			disabled( $locked, true, false )
		);
		if ( $locked ) {
			/* translators: %s: constant name. */
			echo '<p class="description">' . esc_html( sprintf( __( 'Set by %s in wp-config.php.', 'anyhour' ), $args['constant'] ) ) . '</p>';
		}
	}

	/**
	 * The page.
	 */
	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$notice = get_transient( self::NOTICE . get_current_user_id() );
		if ( $notice ) {
			delete_transient( self::NOTICE . get_current_user_id() );
		}
		$state = Options::state();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Anyhour', 'anyhour' ); ?></h1>
			<?php
			if ( is_array( $notice ) ) {
				self::print_notice( $notice );
			}
			?>
			<form action="options.php" method="post">
				<?php
				settings_fields( self::GROUP );
				do_settings_sections( self::PAGE );
				submit_button();
				?>
			</form>

			<hr />
			<h2><?php esc_html_e( 'Check and sync', 'anyhour' ); ?></h2>
			<p><?php esc_html_e( 'Save your settings first.', 'anyhour' ); ?></p>
			<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
				<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
					<input type="hidden" name="action" value="anyhour_test" />
					<?php wp_nonce_field( 'anyhour_test' ); ?>
					<?php submit_button( __( 'Test connection', 'anyhour' ), 'secondary', 'submit', false, '' === Options::assistant_id() ? array( 'disabled' => 'disabled' ) : null ); ?>
				</form>
				<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
					<input type="hidden" name="action" value="anyhour_sync" />
					<?php wp_nonce_field( 'anyhour_sync' ); ?>
					<?php submit_button( __( 'Sync my site now', 'anyhour' ), 'secondary', 'submit', false, Sync::available() ? null : array( 'disabled' => 'disabled' ) ); ?>
				</form>
			</div>
			<?php if ( ! Sync::available() ) : ?>
				<p class="description"><?php esc_html_e( 'Syncing needs an API key.', 'anyhour' ); ?></p>
			<?php endif; ?>
			<?php if ( $state['last_sync_at'] ) : ?>
				<p class="description">
					<?php
					echo esc_html(
						sprintf(
							/* translators: 1: time since the last sync, 2: its result. */
							__( 'Last sync %1$s ago: %2$s', 'anyhour' ),
							human_time_diff( (int) $state['last_sync_at'] ),
							$state['last_message']
						)
					);
					?>
				</p>
			<?php endif; ?>
			<?php
			$next = wp_next_scheduled( Sync::HOOK );
			if ( $next ) :
				?>
				<p class="description">
					<?php
					/* translators: %s: time until the next sync. */
					echo esc_html( sprintf( __( 'Next re-read requested in %s.', 'anyhour' ), human_time_diff( time(), $next ) ) );
					?>
				</p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Print a stored notice: a summary line and optional details.
	 *
	 * @param array $notice ok (bool), message (string), lines (array of [bool, string]).
	 */
	private static function print_notice( array $notice ) {
		printf( '<div class="notice notice-%s is-dismissible"><p><strong>%s</strong></p>', $notice['ok'] ? 'success' : 'error', esc_html( $notice['message'] ) );
		if ( ! empty( $notice['lines'] ) ) {
			echo '<ul style="list-style:disc;padding-left:20px">';
			foreach ( $notice['lines'] as $line ) {
				printf( '<li>%s %s</li>', $line[0] ? '&#10003;' : '&#10007;', esc_html( $line[1] ) );
			}
			echo '</ul>';
		}
		echo '</div>';
	}

	/**
	 * Check the request is from an admin with a valid nonce.
	 *
	 * @param string $action The nonce action.
	 */
	private static function guard( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'anyhour' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( $action );
	}

	/**
	 * Store a notice for the page and go back to it.
	 *
	 * @param array $notice See print_notice.
	 */
	private static function back( array $notice ) {
		set_transient( self::NOTICE . get_current_user_id(), $notice, MINUTE_IN_SECONDS * 5 );
		wp_safe_redirect( admin_url( 'options-general.php?page=' . self::PAGE ) );
		exit;
	}

	/**
	 * "Sync my site now".
	 */
	public static function handle_sync() {
		self::guard( 'anyhour_sync' );
		$result = Sync::run();
		self::back( $result );
	}

	/**
	 * "Test connection": is the chat script reachable, does your AI
	 * exist, is it live, and may it load on this website?
	 */
	public static function handle_test() {
		self::guard( 'anyhour_test' );
		$id    = Options::assistant_id();
		$lines = array();

		$script    = wp_remote_get(
			Embed::script_url(),
			array(
				'timeout'             => 10,
				'limit_response_size' => 4096,
			)
		);
		$script_ok = ! is_wp_error( $script ) && 200 === (int) wp_remote_retrieve_response_code( $script );
		$lines[]   = array(
			$script_ok,
			$script_ok
				? __( 'The chat script is reachable.', 'anyhour' )
				/* translators: %s: script URL. */
				: sprintf( __( 'The chat script could not be loaded from %s.', 'anyhour' ), Embed::script_url() ),
		);

		$ok = $script_ok && ( '' !== Options::api_key() ? self::test_with_key( $id, $lines ) : self::test_public( $id, $lines ) );

		$settings = Options::settings();
		if ( $ok && empty( $settings['show_chat'] ) ) {
			$lines[] = array( false, __( 'The chat is switched off in these settings, so visitors won’t see it yet.', 'anyhour' ) );
		}
		self::back(
			array(
				'ok'      => $ok,
				'message' => $ok ? __( 'Connected to Anyhour.', 'anyhour' ) : __( 'Something needs attention.', 'anyhour' ),
				'lines'   => $lines,
			)
		);
	}

	/**
	 * With an API key: check the key, then read your AI itself.
	 *
	 * @param string $id     AI id.
	 * @param array  $lines  Result lines, added to.
	 * @return bool
	 */
	private static function test_with_key( $id, array &$lines ) {
		$me = Client::request( 'GET', '/api/v1/me' );
		if ( ! $me['ok'] ) {
			$lines[] = array( false, $me['error'] );
			return false;
		}
		/* translators: %s: workspace name. */
		$lines[] = array( true, sprintf( __( 'The API key works for the workspace “%s”.', 'anyhour' ), isset( $me['body']['organizationName'] ) ? $me['body']['organizationName'] : '' ) );

		$desk = Client::request( 'GET', '/api/organizations/' . rawurlencode( (string) $me['body']['organizationId'] ) . '/assistants/' . rawurlencode( $id ) );
		if ( ! $desk['ok'] ) {
			$lines[] = array( false, 404 === $desk['status'] ? __( 'No AI with this id in that workspace. Check the id.', 'anyhour' ) : $desk['error'] );
			return false;
		}
		$name    = isset( $desk['body']['name'] ) ? (string) $desk['body']['name'] : $id;
		$live    = isset( $desk['body']['status'] ) && 'published' === $desk['body']['status'];
		$origins = isset( $desk['body']['allowedOrigins'] ) ? (array) $desk['body']['allowedOrigins'] : array();
		$allowed = in_array( Options::site_origin(), $origins, true );
		/* translators: %s: AI name. */
		$lines[] = array( true, sprintf( __( 'Found %s.', 'anyhour' ), $name ) );
		$lines[] = array( $live, $live ? __( 'It is live.', 'anyhour' ) : __( 'It is offline. Turn it on in Anyhour under Install.', 'anyhour' ) );
		$lines[] = array(
			$allowed,
			$allowed
				/* translators: %s: this site's address. */
				? sprintf( __( '%s is one of its allowed websites.', 'anyhour' ), Options::site_origin() )
				/* translators: %s: this site's address. */
				: sprintf( __( 'Add %s as a website in Anyhour under Install, or the chat won’t load here.', 'anyhour' ), Options::site_origin() ),
		);
		return $live && $allowed;
	}

	/**
	 * Without a key: ask for what the chat itself loads, as this website would.
	 * Anyhour counts this as the chat being seen on this site.
	 *
	 * @param string $id    AI id.
	 * @param array  $lines Result lines, added to.
	 * @return bool
	 */
	private static function test_public( $id, array &$lines ) {
		$launcher = Client::request(
			'GET',
			'/api/widget/' . rawurlencode( $id ) . '/launcher',
			null,
			array(
				'api_key' => '',
				'headers' => array( 'Origin' => Options::site_origin() ),
			)
		);
		if ( $launcher['ok'] ) {
			$name = isset( $launcher['body']['name'] ) ? (string) $launcher['body']['name'] : $id;
			/* translators: %s: AI name. */
			$lines[] = array( true, sprintf( __( '%s is live and may load on this website.', 'anyhour' ), $name ) );
			return true;
		}
		if ( 403 === $launcher['status'] || 404 === $launcher['status'] ) {
			// Anyhour gives one answer for all three, so as not to reveal
			// which AIs exist. An API key tells them apart.
			$lines[] = array(
				false,
				sprintf(
					/* translators: %s: this site's address. */
					__( 'Anyhour didn’t accept this website. In Anyhour under Install, check the id, that your AI is turned on, and that %s is one of its websites. Add an API key to see which one it is.', 'anyhour' ),
					Options::site_origin()
				),
			);
		} else {
			$lines[] = array( false, $launcher['error'] );
		}
		return false;
	}
}
