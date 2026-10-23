<?php
require_once __DIR__ . '/config.php';

header("Content-Type: application/json");
header("Cache-Control: no-store, no-cache, private");
header("Pragma: no-cache");

// ── Validar dominio ───────────────────────────────────────────
$domain = isset($_GET['domain']) ? trim(strtolower($_GET['domain'])) : '';

if (!$domain) {
    http_response_code(400);
    echo json_encode(['error' => 'Se requiere un dominio.']);
    exit;
}

// Limpiar: remover protocolo y paths si el usuario pega una URL
$domain = preg_replace('#^https?://#', '', $domain);
$domain = explode('/', $domain)[0];
$domain = explode('?', $domain)[0];

// Validar formato
if (!preg_match('/^([a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,}$/', $domain)) {
    http_response_code(400);
    echo json_encode(['error' => 'Dominio inválido: ' . htmlspecialchars($domain)]);
    exit;
}

// ── Configurar Multi-cURL con DNS-over-HTTPS (Extremadamente Rápido) ──
$typesMap = [
    'A' => 1, 'AAAA' => 28, 'MX' => 15, 'NS' => 2, 'TXT' => 16,
    'CNAME' => 5, 'SOA' => 6, 'CAA' => 257, 'PTR' => 12, 'SRV' => 33
];

$mh = curl_multi_init();
$curls = [];

$addQuery = function($key, $qname, $typeStr) use ($mh, &$curls) {
    $url = "https://cloudflare-dns.com/dns-query?name=" . urlencode($qname) . "&type=" . $typeStr;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Accept: application/dns-json'],
        CURLOPT_TIMEOUT => 4
    ]);
    curl_multi_add_handle($mh, $ch);
    $curls[$key] = $ch;
};

// Encolar los 10 tipos base, DMARC y los 8 selectores DKIM
foreach ($typesMap as $typeName => $typeId) $addQuery($typeName, $domain, $typeName);
$addQuery('DMARC', "_dmarc.$domain", 'TXT');
$dkimSelectors = ['default', 'google', 'mail', 'selector1', 'selector2', 'k1', 'smtp', 'dkim'];
foreach ($dkimSelectors as $sel) $addQuery("DKIM_$sel", "$sel._domainkey.$domain", 'TXT');

// Ejecutar todas concurrentemente
$running = null;
do {
    curl_multi_exec($mh, $running);
    curl_multi_select($mh);
} while ($running > 0);

$responses = [];
foreach ($curls as $key => $ch) {
    $responses[$key] = curl_multi_getcontent($ch);
    curl_multi_remove_handle($mh, $ch);
}
curl_multi_close($mh);

// ── Procesar Resultados ───────────────────────────────────────
$results = [];
foreach ($typesMap as $typeName => $typeId) {
    $json = json_decode($responses[$typeName], true);
    $parsed = [];
    if (!empty($json['Answer'])) {
        foreach ($json['Answer'] as $ans) {
            if ($ans['type'] !== $typeId) continue;
            $data = $ans['data']; $ttl = $ans['TTL'];
            switch ($typeName) {
                case 'A': case 'AAAA': case 'NS': case 'CNAME': case 'PTR':
                    $parsed[] = ['value' => rtrim($data, '.'), 'ttl' => $ttl]; break;
                case 'MX':
                    $p = explode(' ', $data, 2); $parsed[] = ['value' => rtrim($p[1]??'', '.'), 'priority' => $p[0]??0, 'ttl' => $ttl]; break;
                case 'TXT':
                    $parsed[] = ['value' => trim($data, '"'), 'ttl' => $ttl]; break;
                case 'SOA':
                    $p = explode(' ', $data); $parsed[] = ['mname' => rtrim($p[0]??'', '.'), 'rname' => rtrim($p[1]??'', '.'), 'serial' => $p[2]??'', 'refresh' => $p[3]??'', 'retry' => $p[4]??'', 'expire' => $p[5]??'', 'minimum' => $p[6]??'', 'ttl' => $ttl]; break;
                case 'SRV':
                    $p = explode(' ', $data); $parsed[] = ['priority' => $p[0]??0, 'weight' => $p[1]??0, 'port' => $p[2]??0, 'value' => rtrim($p[3]??'', '.'), 'ttl' => $ttl]; break;
                case 'CAA':
                    $p = explode(' ', $data, 3); $parsed[] = ['flags' => $p[0]??0, 'tag' => $p[1]??'', 'value' => trim($p[2]??'', '"'), 'ttl' => $ttl]; break;
            }
        }
    }
    if (!empty($parsed)) $results[$typeName] = $parsed;
}

// ── Detección de proveedores por NS / TXT ─────────────────────
$providers = [];

$nsRecords   = array_column($results['NS']  ?? [], 'value');
$txtRecords  = array_column($results['TXT'] ?? [], 'value');
$aRecords    = array_column($results['A']   ?? [], 'value');
$mxRecords   = array_column($results['MX']  ?? [], 'value');

$nsStr  = strtolower(implode(' ', $nsRecords));
$txtStr = strtolower(implode(' ', $txtRecords));
$mxStr  = strtolower(implode(' ', $mxRecords));

// CDN / Proxy
if (str_contains($nsStr, 'cloudflare'))       $providers[] = ['name' => 'Cloudflare',        'type' => 'cdn',      'icon' => 'CDN'];
if (str_contains($nsStr, 'awsdns'))           $providers[] = ['name' => 'Amazon Route 53',   'type' => 'dns',      'icon' => 'DNS'];
if (str_contains($nsStr, 'googledomains') || str_contains($nsStr, 'google.com')) $providers[] = ['name' => 'Google Domains', 'type' => 'dns', 'icon' => 'DNS'];
if (str_contains($nsStr, 'godaddy') || str_contains($nsStr, 'domaincontrol')) $providers[] = ['name' => 'GoDaddy', 'type' => 'registrar', 'icon' => 'REG'];
if (str_contains($nsStr, 'digitalocean'))     $providers[] = ['name' => 'DigitalOcean DNS',  'type' => 'dns',      'icon' => 'DNS'];
if (str_contains($nsStr, 'azure') || str_contains($nsStr, 'msft')) $providers[] = ['name' => 'Azure DNS', 'type' => 'dns', 'icon' => 'DNS'];
if (str_contains($nsStr, 'ns.cloudns'))       $providers[] = ['name' => 'ClouDNS',           'type' => 'dns',      'icon' => 'DNS'];

// Email
if (str_contains($mxStr, 'google') || str_contains($mxStr, 'gmail')) $providers[] = ['name' => 'Google Workspace', 'type' => 'email', 'icon' => 'MX'];
if (str_contains($mxStr, 'outlook') || str_contains($mxStr, 'microsoft') || str_contains($mxStr, 'protection.outlook')) $providers[] = ['name' => 'Microsoft 365', 'type' => 'email', 'icon' => 'MX'];
if (str_contains($mxStr, 'mimecast'))         $providers[] = ['name' => 'Mimecast',          'type' => 'email',    'icon' => 'MX'];
if (str_contains($mxStr, 'proofpoint'))       $providers[] = ['name' => 'Proofpoint',        'type' => 'email',    'icon' => 'MX'];

// SPF / DKIM / DMARC
$hasSPF   = (bool) preg_grep('/v=spf1/i',  $txtRecords);

$hasDMARC = false;
$dmarcRes = json_decode($responses['DMARC'], true);
if (!empty($dmarcRes['Answer'])) {
    foreach ($dmarcRes['Answer'] as $ans) {
        if (stripos($ans['data'], 'v=DMARC1') !== false) { $hasDMARC = true; break; }
    }
}

$dkimFound = [];
foreach ($dkimSelectors as $sel) {
    $dkimRes = json_decode($responses["DKIM_$sel"], true);
    if (!empty($dkimRes['Answer'])) {
        foreach ($dkimRes['Answer'] as $ans) {
            if (stripos($ans['data'], 'v=DKIM1') !== false || stripos($ans['data'], 'p=') !== false) {
                $dkimFound[] = $sel; break;
            }
        }
    }
}

// ── WHOIS básico (IP del servidor) ───────────────────────────
$serverIP = null;
if (!empty($aRecords)) {
    $serverIP = $aRecords[0];
}

echo json_encode([
    'domain'    => $domain,
    'records'   => $results,
    'ns'        => $nsRecords,
    'server_ip' => $serverIP,
    'providers' => $providers,
    'email_security' => [
        'spf'   => $hasSPF,
        'dmarc' => $hasDMARC,
        'dkim'  => $dkimFound,
    ],
    'total_types' => count($results),
], JSON_PRETTY_PRINT);
?>
