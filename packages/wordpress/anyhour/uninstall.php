<?php
/**
 * Removes everything the plugin stored when it is deleted.
 *
 * @package Anyhour
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Remove this site's options, transients and scheduled sync.
 */
function anyhour_uninstall_site() {
	delete_option( 'anyhour_settings' );
	delete_option( 'anyhour_sync_state' );
	delete_transient( 'anyhour_sync_lock' );
	wp_clear_scheduled_hook( 'anyhour_sync' );
	// Per-user notices expire within minutes; remove any left over.
	global $wpdb;
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_anyhour_notice_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_anyhour_notice_' ) . '%'
		)
	);
}

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids', 'number' => 0 ) ) as $anyhour_site_id ) {
		switch_to_blog( $anyhour_site_id );
		anyhour_uninstall_site();
		restore_current_blog();
	}
} else {
	anyhour_uninstall_site();
}
