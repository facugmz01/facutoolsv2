<?php
require_once __DIR__ . '/config.php';

header("Content-Type: application/json");
header("Cache-Control: no-store, no-cache, private");

$domain = isset($_GET['domain']) ? trim(strtolower($_GET['domain'])) : '';

if (empty($domain)) {
    http_response_code(400);
    echo json_encode(['error' => 'Se requiere un dominio válido.']);
    exit;
}

// Limpieza básica de la URL
$domain = preg_replace('#^https?://#', '', $domain);
$domain = explode('/', $domain)[0];

// Suponiendo que has agregado DOMSCAN_API_KEY a tu config.php / .env
$apiKey = defined('DOMSCAN_API_KEY') ? DOMSCAN_API_KEY : '';

$url = "https://api.domscan.net/v1/scan?domain=" . urlencode($domain);

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: application/json',
    'Authorization: Bearer ' . $apiKey
]);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);

$response = curl_exec($ch);
$error = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Error al conectar con DOMSCAN: ' . $error]);
    exit;
}

echo $response;
?>