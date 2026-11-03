<?php
/**
 * Prints the chat's embed script on the public site.
 *
 * @package Anyhour
 */

namespace Anyhour;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Prints the same snippet the Install page gives owners, in the footer:
 *
 * <script src="https://…/embed.js" data-bot="ID" data-api="https://…" async></script>
 *
 * The script reads its settings from its own data attributes, waits for the
 * page to finish loading, and only then draws the chat.
 */
final class Embed {

	const HANDLE = 'anyhour-embed';

	/**
	 * Hook into the front end.
	 */
	public static function register() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_filter( 'script_loader_tag', array( __CLASS__, 'tag' ), 10, 2 );
	}

	/**
	 * Whether this page shows the chat. Developers can turn it off for a page:
	 *
	 *     add_filter( 'anyhour_show_chat', function ( $show ) {
	 *         return is_page( 'checkout' ) ? false : $show;
	 *     } );
	 *
	 * @return bool
	 */
	public static function should_show() {
		if ( is_admin() || wp_doing_ajax() || is_feed() || is_embed() ) {
			return false;
		}
		$settings = Options::settings();
		$show     = ! empty( $settings['show_chat'] ) && '' !== Options::assistant_id();
		/**
		 * Filters whether the chat is printed on the current page.
		 *
		 * @param bool $show True when the chat is switched on and set up.
		 */
		return (bool) apply_filters( 'anyhour_show_chat', $show );
	}

	/**
	 * Enqueue the loader in the footer.
	 */
	public static function enqueue() {
		if ( ! self::should_show() ) {
			return;
		}
		// No version: the snippet loads embed.js as-is, and the CDN caches it.
		// phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion
		wp_enqueue_script( self::HANDLE, self::script_url(), array(), null, true );
	}

	/**
	 * The loader's address.
	 *
	 * @return string
	 */
	public static function script_url() {
		return Options::widget_url() . '/embed.js';
	}

	/**
	 * The snippet's attributes, in the product's order.
	 *
	 * @return array<string,string|bool>
	 */
	public static function attributes() {
		$attributes = array(
			'src'      => self::script_url(),
			'data-bot' => Options::assistant_id(),
			'data-api' => Options::api_url(),
			'async'    => true,
		);
		/**
		 * Filters the embed script's attributes. A value of true prints a bare
		 * attribute (like async); false or null drops it.
		 *
		 * @param array $attributes Attribute name => value.
		 */
		return (array) apply_filters( 'anyhour_embed_attributes', $attributes );
	}

	/**
	 * Replace WordPress's tag for the loader with the exact snippet.
	 *
	 * @param string $tag    The tag WordPress built.
	 * @param string $handle The script handle.
	 * @return string
	 */
	public static function tag( $tag, $handle ) {
		if ( self::HANDLE !== $handle ) {
			return $tag;
		}
		$html = '';
		foreach ( self::attributes() as $name => $value ) {
			$name = preg_replace( '/[^a-zA-Z0-9_:-]/', '', (string) $name );
			if ( '' === $name || false === $value || null === $value ) {
				continue;
			}
			if ( true === $value ) {
				$html .= ' ' . $name;
				continue;
			}
			$html .= sprintf( ' %s="%s"', $name, 'src' === $name ? esc_url( (string) $value ) : esc_attr( (string) $value ) );
		}
		// The loader finds its settings through document.currentScript, so it
		// must stay its own tag, not inlined or combined.
		// phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript
		return '<script' . $html . "></script>\n";
	}
}
