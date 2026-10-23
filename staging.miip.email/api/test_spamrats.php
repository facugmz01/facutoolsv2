<?php
require_once __DIR__ . '/config.php';

header("Content-Type: application/json");
header("Cache-Control: no-store, no-cache, private");

if (!TEST_TOKEN) {
    http_response_code(500);
    echo json_encode(['error' => 'Configurá TEST_TOKEN en el .env. Ej: TEST_TOKEN=mi_clave_123']);
    exit;
}

$tokenProvided = $_GET['token'] ?? '';
if (!hash_equals(TEST_TOKEN, $tokenProvided)) {
    http_response_code(403);
    echo json_encode(['error' => 'Token incorrecto. Usá: /api/test_spamrats.php?token=<tu_TEST_TOKEN>']);
    exit;
}

if (!SPAMRATS_KEY) {
    echo json_encode(['error' => 'SPAMRATS_KEY no configurada en .env']);
    exit;
}

$key = SPAMRATS_KEY;

// ── IP pública real del servidor ──────────────────────────────
// SERVER_ADDR puede ser 127.0.0.1 si hay proxy; buscamos la IP real
function getServerPublicIP(): string {
    // 1. Header de Cloudflare (si aplica)
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        // Esta es la IP del CLIENTE, no del servidor — la ignoramos
    }
    // 2. Intentar via servicio externo (rápido, 2s timeout)
    $ch = curl_init('https://api.ipify.org');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
    ]);
    $ip = curl_exec($ch);
    curl_close($ch);
    if ($ip && filter_var(trim($ip), FILTER_VALIDATE_IP)) return trim($ip);

    // 3. Fallback a SERVER_ADDR
    return $_SERVER['SERVER_ADDR'] ?? 'desconocida';
}

// ── Resolver DNS que está usando el sistema ───────────────────
function getSystemResolvers(): array {
    $resolvers = [];
    // /etc/resolv.conf
    if (file_exists('/etc/resolv.conf')) {
        preg_match_all('/^nameserver\s+(.+)$/m', file_get_contents('/etc/resolv.conf'), $m);
        $resolvers = array_map('trim', $m[1] ?? []);
    }
    return $resolvers ?: ['desconocido'];
}

function resolverType(array $resolvers): string {
    $public = ['8.8.8.8','8.8.4.4','1.1.1.1','1.0.0.1','9.9.9.9','208.67.222.222'];
    foreach ($resolvers as $r) {
        if (in_array($r, $public)) return "⛔ Resolver PÚBLICO ($r) — SpamRATS bloqueará las queries";
        if ($r === '127.0.0.53') return "⚠️  systemd-resolved (127.0.0.53) — reenvía a upstream, posiblemente público";
        if (in_array($r, ['127.0.0.1','::1'])) return "✅ Resolver LOCAL ($r) — correcto para SpamRATS";
    }
    return "❓ Desconocido";
}

// ── Tests SpamRATS ────────────────────────────────────────────
$results = [];
foreach (['dyna', 'noptr', 'spam'] as $list) {
    $qListed = "36.0.0.127.{$key}.{$list}.spamrats.com";
    $qClean  = "1.0.0.127.{$key}.{$list}.spamrats.com";

    $rListed = @dns_get_record($qListed, DNS_A);
    $rClean  = @dns_get_record($qClean,  DNS_A);

    $listedOk = !empty($rListed) && ($rListed[0]['ip'] ?? '') === '127.0.0.36';
    $cleanOk  = $rClean !== false && empty($rClean);

    $results['RATS-' . strtoupper($list)] = [
        'test_ip_listada' => [
            'query'    => $qListed,
            'esperado' => '127.0.0.36',
            'obtenido' => match(true) {
                $rListed === false    => '⛔ DNS_ERROR — bloqueado o timeout',
                empty($rListed)       => '❌ NXDOMAIN — key inválida o inactiva',
                default               => '✅ ' . ($rListed[0]['ip'] ?? '?'),
            },
            'ok' => $listedOk,
        ],
        'test_ip_limpia' => [
            'query'    => $qClean,
            'esperado' => 'NXDOMAIN',
            'obtenido' => match(true) {
                $rClean === false  => '⛔ DNS_ERROR — bloqueado o timeout',
                empty($rClean)     => '✅ NXDOMAIN — correcto',
                default            => '❌ ' . ($rClean[0]['ip'] ?? '?') . ' — debería ser NXDOMAIN',
            },
            'ok' => $cleanOk,
        ],
    ];
}

// ── Recopilar info del servidor ───────────────────────────────
$serverPublicIP = getServerPublicIP();
$serverPtr      = @gethostbyaddr($serverPublicIP);
$ptrOk          = $serverPtr && $serverPtr !== $serverPublicIP;
$resolvers      = getSystemResolvers();
$resolverStatus = resolverType($resolvers);

// ── Diagnóstico ───────────────────────────────────────────────
$dnsBlocked = false;
$keyBad     = false;
$allOk      = true;

foreach ($results as $r) {
    if (str_contains($r['test_ip_listada']['obtenido'], 'DNS_ERROR')) { $dnsBlocked = true; $allOk = false; }
    if (str_contains($r['test_ip_listada']['obtenido'], 'NXDOMAIN'))  { $keyBad = true;     $allOk = false; }
}

$steps = [];
if ($dnsBlocked) {
    if (str_contains($resolverStatus, '⛔') || str_contains($resolverStatus, '⚠️')) {
        $steps[] = "1. Instalá unbound: apt install unbound -y";
        $steps[] = "2. Configurá el resolver: echo 'nameserver 127.0.0.1' > /etc/resolv.conf";
        $steps[] = "3. Verificá: dig @127.0.0.1 google.com";
        $steps[] = "4. Probá SpamRATS: host 36.0.0.127.{$key}.dyna.spamrats.com 127.0.0.1";
    }
    if (!$ptrOk) {
        $steps[] = "5. Configurá el PTR de la IP {$serverPublicIP} en el panel del hosting (Reverse DNS)";
    }
}

$diagnosis = match(true) {
    $allOk      => '✅ SpamRATS funciona correctamente. La key es válida.',
    $dnsBlocked => '⛔ Queries DNS bloqueadas. SpamRATS no puede ser consultado desde este servidor con el resolver actual.',
    $keyBad     => '⚠️ DNS responde pero la key no devuelve resultados. Verificá que la key esté activa en spamrats.com.',
    default     => '⚠️ Resultado mixto.',
};

echo json_encode([
    'diagnostico'   => $diagnosis,
    'pasos'         => $steps,
    'todo_ok'       => $allOk,
    'key_preview'   => substr($key, 0, 4) . str_repeat('*', max(0, strlen($key) - 8)) . substr($key, -4),
    'servidor'      => [
        'ip_publica'     => $serverPublicIP,
        'ptr_record'     => $ptrOk ? "✅ $serverPtr" : "⚠️ Sin PTR — configuralo en el panel del hosting",
        'resolvers'      => $resolvers,
        'resolver_status'=> $resolverStatus,
    ],
    'tests' => $results,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>
