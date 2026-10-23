<?php
require_once 'config.php';

header('Content-Type: application/json');

$apiKey = $_ENV['RANSOMWARE_LIVE_KEY'] ?? '';

$endpoint = ltrim($_GET['endpoint'] ?? 'victims/recent', '/');
// Remover endpoint del $_GET para construir los query params reales
$params = $_GET;
unset($params['endpoint']);

$base = 'https://api-pro.ransomware.live/';
$url = $base . $endpoint;

if (!empty($params)) {
    $url .= '?' . http_build_query($params);
}

// ── Sistema de Caché de Alto Rendimiento ──────────────────────
// Guarda la respuesta por 5 minutos (300 segundos) para evitar bloqueos
$cacheKey = md5($url . $apiKey);
$cacheFile = sys_get_temp_dir() . '/ipscope_ransom_' . $cacheKey . '.json';
$cacheTTL = 300; 

if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTTL) {
    // Retornar datos desde la caché del sistema (Instantáneo)
    header('X-Cache: HIT');
    echo file_get_contents($cacheFile);
    exit;
}

header('X-Cache: MISS');

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_USERAGENT, 'IPScope/1.0');

$headers = ['Accept: application/json'];
if (!empty($apiKey)) {
    $headers[] = 'X-API-KEY: ' . $apiKey;
}
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Error al conectar con Ransomware Live: ' . $error]);
    exit;
}

if ($httpCode !== 200) {
    http_response_code($httpCode);
    $decoded = json_decode($response, true);
    $msg = $decoded['message'] ?? 'Error de la API de Ransomware Live';
    echo json_encode(['error' => $msg]);
    exit;
}

// ── Guardar respuesta exitosa en caché ────────────────────────
if ($response && json_decode($response) !== null) {
    // Usamos flock LOCK_EX para evitar condiciones de carrera si múltiples usuarios consultan a la vez
    file_put_contents($cacheFile, $response, LOCK_EX);
}

echo $response;
?>
