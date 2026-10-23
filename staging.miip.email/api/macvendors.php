<?php
require_once 'config.php';

header('Content-Type: application/json');

$apiKey = defined('MACVENDORS_API_KEY') && MACVENDORS_API_KEY !== '' ? MACVENDORS_API_KEY : ($_ENV['MACVENDORS_API_KEY'] ?? '');

$mac = trim($_GET['mac'] ?? '');
if (empty($mac)) {
    // http_response_code(400); // Evitar que Apache intercepte códigos de error no-200
    echo json_encode(['error' => 'El parámetro MAC es requerido.']);
    exit;
}

// Limpiar y validar dirección MAC básica (debe tener al menos 6 caracteres hexadecimales)
$macClean = preg_replace('/[^a-fA-F0-9]/', '', $mac);
if (strlen($macClean) < 6) {
    // http_response_code(400); // Evitar que Apache intercepte códigos de error no-200
    echo json_encode(['error' => 'Dirección MAC no válida. Debe contener al menos el prefijo del fabricante (OUI - 6 dígitos hexa).']);
    exit;
}

// Si la API key está presente, usar la API V1 con Bearer token.
// De lo contrario, usar el endpoint público básico.
$useApiKey = !empty($apiKey);
$url = $useApiKey ? 'https://api.macvendors.com/v1/lookup/' . urlencode($mac) : 'https://api.macvendors.com/' . urlencode($mac);
$headers = $useApiKey ? [
    'Accept: application/json',
    'Authorization: Bearer ' . $apiKey
] : [
    'Accept: application/json'
];

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_USERAGENT, 'IPScope/1.0');
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

// Fallback transparente: si la API key devolvió un error de autenticación (401 o 403),
// intentamos obtener los datos usando el endpoint público gratuito.
if ($useApiKey && ($httpCode === 401 || $httpCode === 403 || $response === false)) {
    $useApiKey = false;
    $url = 'https://api.macvendors.com/' . urlencode($mac);
    $headers = [
        'Accept: application/json'
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'IPScope/1.0');
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
}

if ($response === false) {
    // http_response_code(500); // Evitar que Apache intercepte códigos de error no-200
    echo json_encode(['error' => 'Error al conectar con la API de MACVendors: ' . $error]);
    exit;
}

if ($httpCode === 404) {
    // http_response_code(404); // Evitar que Apache intercepte códigos de error no-200
    echo json_encode(['error' => 'Fabricante no encontrado para la dirección MAC especificada.']);
    exit;
}

if ($httpCode === 429) {
    // http_response_code(429); // Evitar que Apache intercepte códigos de error no-200
    echo json_encode(['error' => 'Límite de peticiones excedido (Rate Limit). Por favor espera o configura tu API key.']);
    exit;
}

if ($httpCode !== 200) {
    // http_response_code($httpCode); // Evitar que Apache intercepte códigos de error no-200
    $decoded = json_decode($response, true);
    $msg = $decoded['message'] ?? $decoded['error'] ?? $decoded['errors']['detail'] ?? 'Error desconocido de la API MACVendors.';
    echo json_encode(['error' => $msg]);
    exit;
}

// La API pública devuelve texto plano (nombre del fabricante).
// La API V1 devuelve JSON: {"data": {"mac": "...", "organization_name": "..."}}
// Estandarizamos la respuesta devuelta al frontend:
if ($useApiKey) {
    $decoded = json_decode($response, true);
    $vendorName = $decoded['data']['organization_name']
                  ?? $decoded['data']['vendor']
                  ?? $decoded['data']['company']
                  ?? $decoded['vendor']
                  ?? 'Desconocido';
    echo json_encode([
        'mac' => $mac,
        'vendor' => $vendorName,
        'source' => 'macvendors.com V1 (API Key)'
    ]);
} else {
    echo json_encode([
        'mac' => $mac,
        'vendor' => trim($response),
        'source' => 'macvendors.com (Público)'
    ]);
}
?>
