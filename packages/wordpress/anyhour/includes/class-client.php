<?php
/**
 * A small HTTP client for the Anyhour API.
 *
 * @package Anyhour
 */

namespace Anyhour;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Calls the Anyhour API with wp_remote_request. Every call returns the
 * same shape, so callers never deal with WP_Error or raw bodies.
 */
final class Client {

	/**
	 * Make one request.
	 *
	 * @param string     $method  HTTP method.
	 * @param string     $path    Path on the API, starting with "/".
	 * @param array|null $body    JSON body, if any.
	 * @param array      $options api_key (string, '' for none), headers (array), timeout (int).
	 * @return array{ok:bool,status:int,body:mixed,error:string,code:string,next_cursor:string}
	 */
	public static function request( $method, $path, $body = null, array $options = array() ) {
		$options = wp_parse_args(
			$options,
			array(
				'api_key' => Options::api_key(),
				'headers' => array(),
				'timeout' => 15,
			)
		);
		$headers = array_merge(
			array(
				'Accept'     => 'application/json',
				'User-Agent' => 'Anyhour-WordPress/' . ANYHOUR_VERSION . '; ' . home_url( '/' ),
			),
			$options['headers']
		);
		if ( '' !== $options['api_key'] ) {
			$headers['Authorization'] = 'Bearer ' . $options['api_key'];
		}
		$args = array(
			'method'      => $method,
			'timeout'     => (int) $options['timeout'],
			'redirection' => 0,
			'headers'     => $headers,
		);
		if ( null !== $body ) {
			$args['headers']['Content-Type'] = 'application/json';
			$args['body']                    = wp_json_encode( $body );
		}

		$response = wp_remote_request( Options::api_url() . $path, $args );
		if ( is_wp_error( $response ) ) {
			return array(
				'ok'          => false,
				'status'      => 0,
				'body'        => null,
				/* translators: %s: the network error. */
				'error'       => sprintf( __( 'Could not reach Anyhour: %s', 'anyhour' ), $response->get_error_message() ),
				'code'        => 'network_error',
				'next_cursor' => '',
			);
		}

		$status  = (int) wp_remote_retrieve_response_code( $response );
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$ok      = $status >= 200 && $status < 300;
		$error   = '';
		$code    = '';
		if ( ! $ok ) {
			$code  = isset( $decoded['error']['code'] ) ? (string) $decoded['error']['code'] : 'http_' . $status;
			$error = isset( $decoded['error']['message'] )
				? (string) $decoded['error']['message']
				/* translators: %d: HTTP status code. */
				: sprintf( __( 'Anyhour answered with HTTP %d.', 'anyhour' ), $status );
		}
		return array(
			'ok'          => $ok,
			'status'      => $status,
			'body'        => $decoded,
			'error'       => $error,
			'code'        => $code,
			'next_cursor' => (string) wp_remote_retrieve_header( $response, 'x-next-cursor' ),
		);
	}
}
