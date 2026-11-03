<?php
/**
 * Reading the plugin's stored settings and sync state.
 *
 * @package Anyhour
 */

namespace Anyhour;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The plugin keeps two options: the owner's settings, and what the last
 * content sync learned and did.
 */
final class Options {

	const SETTINGS = 'anyhour_settings';
	const STATE    = 'anyhour_sync_state';

	/**
	 * Settings with defaults filled in.
	 *
	 * @return array{front_desk_id:string,show_chat:bool,api_key:string,auto_sync:bool,api_url:string,widget_url:string}
	 */
	public static function settings() {
		$stored = get_option( self::SETTINGS, array() );
		return wp_parse_args( is_array( $stored ) ? $stored : array(), self::defaults() );
	}

	/**
	 * Settings before the owner saves anything.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			// The AI id, stored under its original key name.
			'front_desk_id' => '',
			'show_chat'     => false,
			'api_key'       => '',
			'auto_sync'     => true,
			'api_url'       => '',
			'widget_url'    => '',
		);
	}

	/**
	 * The AI id, or '' when not set.
	 *
	 * @return string
	 */
	public static function assistant_id() {
		return (string) self::settings()['front_desk_id'];
	}

	/**
	 * The workspace API key, or '' when not set.
	 *
	 * @return string
	 */
	public static function api_key() {
		return (string) self::settings()['api_key'];
	}

	/**
	 * The Anyhour API origin, without a trailing slash.
	 *
	 * @return string
	 */
	public static function api_url() {
		if ( defined( 'ANYHOUR_API_URL' ) ) {
			return untrailingslashit( (string) ANYHOUR_API_URL );
		}
		$saved = self::settings()['api_url'];
		return untrailingslashit( $saved ? $saved : ANYHOUR_DEFAULT_API_URL );
	}

	/**
	 * Where the chat script (embed.js) is served from, without a trailing slash.
	 *
	 * @return string
	 */
	public static function widget_url() {
		if ( defined( 'ANYHOUR_WIDGET_URL' ) ) {
			return untrailingslashit( (string) ANYHOUR_WIDGET_URL );
		}
		$saved = self::settings()['widget_url'];
		return untrailingslashit( $saved ? $saved : ANYHOUR_DEFAULT_WIDGET_URL );
	}

	/**
	 * What the last sync found (ids it can reuse) and how it went.
	 *
	 * @return array{organization_id:string,source_id:string,last_sync_at:int,last_ok:bool,last_message:string}
	 */
	public static function state() {
		$stored = get_option( self::STATE, array() );
		return wp_parse_args(
			is_array( $stored ) ? $stored : array(),
			array(
				'organization_id' => '',
				'source_id'       => '',
				'last_sync_at'    => 0,
				'last_ok'         => false,
				'last_message'    => '',
			)
		);
	}

	/**
	 * Merge changes into the sync state. Not autoloaded: only sync reads it.
	 *
	 * @param array $changes Fields to change.
	 */
	public static function update_state( array $changes ) {
		update_option( self::STATE, array_merge( self::state(), $changes ), false );
	}

	/**
	 * This site's host, lower case and without "www.", for matching it to the
	 * website your AI reads.
	 *
	 * @param string $url A URL; defaults to the site's home page.
	 * @return string
	 */
	public static function site_host( $url = '' ) {
		$host = (string) wp_parse_url( $url ? $url : home_url( '/' ), PHP_URL_HOST );
		$host = strtolower( $host );
		return 0 === strpos( $host, 'www.' ) ? substr( $host, 4 ) : $host;
	}

	/**
	 * This site's origin (scheme, host and port), as browsers send it.
	 *
	 * @return string
	 */
	public static function site_origin() {
		$parts  = wp_parse_url( home_url( '/' ) );
		$origin = ( isset( $parts['scheme'] ) ? $parts['scheme'] : 'https' ) . '://' . ( isset( $parts['host'] ) ? $parts['host'] : '' );
		if ( ! empty( $parts['port'] ) ) {
			$origin .= ':' . $parts['port'];
		}
		return $origin;
	}
}
