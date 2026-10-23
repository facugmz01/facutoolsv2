<?php
require_once __DIR__ . '/config.php';

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Cache-Control: no-store, no-cache, private");
header("Pragma: no-cache");

if (!IPDATA_API_KEY) {
    http_response_code(500);
    echo json_encode(['message' => 'IPDATA_API_KEY no configurada. Revisá el archivo .env']);
    exit;
}

function getClientIP(): string {
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $ip = trim($_SERVER['HTTP_CF_CONNECTING_IP']);
        if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
    }
    return $_SERVER['REMOTE_ADDR'];
}

$ip = '';
if (isset($_GET['ip']) && $_GET['ip'] !== '') {
    $raw = trim($_GET['ip']);
    if (filter_var($raw, FILTER_VALIDATE_IP)) {
        $ip = $raw;
    } elseif (preg_match('/^[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$/', $raw)) {
        $resolved = gethostbyname($raw);
        if ($resolved !== $raw && filter_var($resolved, FILTER_VALIDATE_IP)) {
            $ip = $resolved;
        } else {
            http_response_code(400);
            echo json_encode(['message' => 'No se pudo resolver el dominio: ' . $raw]);
            exit;
        }
    } else {
        http_response_code(400);
        echo json_encode(['message' => 'IP o dominio inválido.']);
        exit;
    }
} else {
    $ip = getClientIP();
}

$fields = implode(',', [
    'ip', 'is_eu',
    'continent_name', 'continent_code',
    'country_name', 'country_code',
    'flag', 'emoji_flag',
    'region', 'region_code', 'region_type',
    'city', 'postal', 'calling_code',
    'latitude', 'longitude',
    'time_zone', 'currency', 'asn', 'threat',
]);

$url = "https://api.ipdata.co/{$ip}?api-key=" . IPDATA_API_KEY . "&fields={$fields}";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    http_response_code(502);
    echo json_encode(['message' => 'Error de conexión con la API: ' . $curlError]);
    exit;
}

http_response_code($httpCode);
echo $response;
?>
