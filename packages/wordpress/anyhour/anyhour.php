<?php
/**
 * Plugin Name:       Anyhour – your AI
 * Description:       Puts your Anyhour AI on your website. It answers visitors from what it has learned about your business, captures enquiries and alerts you.
 * Version:           0.1.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Anyhour
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       anyhour
 *
 * @package Anyhour
 */

namespace Anyhour;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ANYHOUR_VERSION', '0.1.0' );
define( 'ANYHOUR_FILE', __FILE__ );

// Where Anyhour runs. Override either in wp-config.php (for local
// development or a self-hosted install), or under Advanced on the settings page.
if ( ! defined( 'ANYHOUR_DEFAULT_API_URL' ) ) {
	define( 'ANYHOUR_DEFAULT_API_URL', 'https://api.anyhour.app' );
}
if ( ! defined( 'ANYHOUR_DEFAULT_WIDGET_URL' ) ) {
	define( 'ANYHOUR_DEFAULT_WIDGET_URL', 'https://widget.anyhour.app' );
}

require_once __DIR__ . '/includes/class-options.php';
require_once __DIR__ . '/includes/class-client.php';
require_once __DIR__ . '/includes/class-embed.php';
require_once __DIR__ . '/includes/class-sync.php';
require_once __DIR__ . '/includes/class-settings.php';

Embed::register();
Sync::register();

if ( is_admin() ) {
	Settings::register();
}

register_deactivation_hook( __FILE__, array( Sync::class, 'unschedule' ) );
