<?php
/**
 * IPScope — Cargador de configuración
 * Lee el archivo .env de la raíz del proyecto y define las constantes de API keys.
 * Incluir con: require_once __DIR__ . '/../api/config.php';
 * O desde dentro de /api/: require_once __DIR__ . '/config.php';
 */

// Evitar carga múltiple
if (defined('IPSCOPE_CONFIG_LOADED')) return;
define('IPSCOPE_CONFIG_LOADED', true);

// ── Ubicar y cargar el .env ───────────────────────────────────
$envFile = dirname(__DIR__) . '/.env';

if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        // Ignorar comentarios y líneas vacías
        if ($line === '' || str_starts_with($line, '#')) continue;
        // Parsear KEY=VALUE
        if (!str_contains($line, '=')) continue;
        [$key, $value] = explode('=', $line, 2);
        $key   = trim($key);
        $value = trim($value);
        // Remover comillas opcionales del valor
        $value = trim($value, '"\'');
        // Solo setear si el key es alfanumérico+guión bajo y no está ya definido
        if (preg_match('/^[A-Z][A-Z0-9_]+$/', $key) && !array_key_exists($key, $_ENV)) {
            $_ENV[$key] = $value;
            putenv("$key=$value");
        }
    }
}

// ── Función helper para leer keys ─────────────────────────────
function config(string $key, string $default = ''): string {
    // Prioridad: variable de entorno del servidor > .env
    $val = getenv($key);
    return ($val !== false && $val !== '') ? $val : ($default);
}

// ── Constantes de las API keys ────────────────────────────────
define('IPDATA_API_KEY', config('IPDATA_API_KEY'));
define('ABUSEIPDB_KEY',  config('ABUSEIPDB_KEY'));
define('SPAMRATS_KEY',   config('SPAMRATS_KEY'));
define('SPAMHAUS_DQS_KEY', config('SPAMHAUS_DQS_KEY'));
define('TEST_TOKEN',      config('TEST_TOKEN'));
define('MACVENDORS_API_KEY', config('MACVENDORS_API_KEY'));
define('DOMSCAN_API_KEY', config('DOMSCAN_API_KEY'));
define('RANSOMWARE_LIVE_KEY', config('RANSOMWARE_LIVE_KEY'));
