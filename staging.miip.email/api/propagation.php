<?php
require_once __DIR__ . '/config.php';

header("Content-Type: application/json");
header("Cache-Control: no-store, no-cache, private");
header("Pragma: no-cache");

// ── Validar parámetros ────────────────────────────────────────
$domain = isset($_GET['domain']) ? trim(strtolower($_GET['domain'])) : '';
$type   = strtoupper($_GET['type'] ?? 'A');

if (!$domain) { http_response_code(400); echo json_encode(['error' => 'Se requiere un dominio.']); exit; }

$domain = preg_replace('#^https?://#', '', $domain);
$domain = explode('/', $domain)[0];
$domain = explode('?', $domain)[0];
$domain = rtrim($domain, '.');

if (!preg_match('/^([a-zA-Z0-9\-\_]+\.)+[a-zA-Z]{2,}$/', $domain)) {
    http_response_code(400); echo json_encode(['error' => 'Dominio inválido.']); exit;
}

$allowedTypes = ['A','AAAA','MX','NS','TXT','CNAME','SOA'];
if (!in_array($type, $allowedTypes)) {
    http_response_code(400); echo json_encode(['error' => 'Tipo inválido.']); exit;
}

// ── Servidores DNS ────────────────────────────────────────────
$DNS_SERVERS = [
    ['ip'=>'8.8.8.8',         'name'=>'Google',           'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'8.8.4.4',         'name'=>'Google Secondary', 'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'1.1.1.1',         'name'=>'Cloudflare',       'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'1.0.0.1',         'name'=>'Cloudflare Alt',   'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'208.67.222.222',  'name'=>'OpenDNS',          'location'=>'US',            'flag'=>'🇺🇸'],
    ['ip'=>'208.67.220.220',  'name'=>'OpenDNS Alt',      'location'=>'US',            'flag'=>'🇺🇸'],
    ['ip'=>'9.9.9.9',         'name'=>'Quad9',            'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'149.112.112.112', 'name'=>'Quad9 Alt',        'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'45.90.28.230',    'name'=>'NextDNS',          'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'185.222.222.222', 'name'=>'DNS.SB',           'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'76.76.2.0',       'name'=>'ControlD',         'location'=>'Global',        'flag'=>'🌐'],
    ['ip'=>'200.221.11.100',  'name'=>'Registro.br',      'location'=>'Brasil',        'flag'=>'🇧🇷'],
    ['ip'=>'185.228.168.9',   'name'=>'CleanBrowsing',    'location'=>'Europa',        'flag'=>'🇪🇺'],
    ['ip'=>'77.88.8.8',       'name'=>'Yandex DNS',       'location'=>'Rusia',         'flag'=>'🇷🇺'],
    ['ip'=>'195.46.39.39',    'name'=>'SafeDNS',          'location'=>'Europa',        'flag'=>'🇪🇺'],
    ['ip'=>'168.126.63.1',    'name'=>'KT DNS',           'location'=>'Corea del Sur', 'flag'=>'🇰🇷'],
    ['ip'=>'101.226.4.6',     'name'=>'DNSPod China',     'location'=>'China',         'flag'=>'🇨🇳'],
    ['ip'=>'114.114.114.114', 'name'=>'114DNS',           'location'=>'China',         'flag'=>'🇨🇳'],
    ['ip'=>'5.11.11.5',       'name'=>'Liquid Telecom',   'location'=>'Sudáfrica',     'flag'=>'🇿🇦'],
    ['ip'=>'4.2.2.2',         'name'=>'Level3 Lumen',    'location'=>'US',            'flag'=>'🇺🇸'],
    ['ip'=>'94.140.14.14',    'name'=>'AdGuard DNS',      'location'=>'Global',        'flag'=>'🌐'],
];

// ── Construir packet DNS ──────────────────────────────────────
function buildDNSQuery(string $domain, string $type): string {
    $typeMap = ['A'=>1,'AAAA'=>28,'MX'=>15,'NS'=>2,'TXT'=>16,'CNAME'=>5,'SOA'=>6];
    $typeNum  = $typeMap[$type] ?? 1;
    $id       = rand(1, 65535);
    $question = '';
    foreach (explode('.', $domain) as $label) $question .= chr(strlen($label)) . $label;
    $question .= "\x00" . pack('n', $typeNum) . "\x00\x01";
    return pack('n', $id) . "\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00" . $question;
}

// ── Helper para decodificar nombres de dominio DNS (con soporte para punteros de compresión) ──
function decodeDNSName(string $packet, int &$offset): string {
    $name = '';
    $visited = [];
    $originalOffset = null;
    $hasPointer = false;

    while (true) {
        if ($offset >= strlen($packet)) {
            break;
        }
        $len = ord($packet[$offset]);
        if ($len === 0) {
            $offset++;
            break;
        }

        // Si los dos bits más significativos están activos (11xxxxxx), es un puntero
        if (($len & 0xC0) === 0xC0) {
            if ($offset + 1 >= strlen($packet)) {
                break;
            }
            $ptr = (($len & 0x3F) << 8) | ord($packet[$offset + 1]);
            if (!$hasPointer) {
                $originalOffset = $offset + 2;
                $hasPointer = true;
            }
            if (in_array($ptr, $visited)) {
                break; // Prevenir bucles infinitos por punteros circulares
            }
            $visited[] = $ptr;
            $offset = $ptr;
            continue;
        }

        if ($offset + 1 + $len > strlen($packet)) {
            break;
        }
        $label = substr($packet, $offset + 1, $len);
        $offset += 1 + $len;

        if ($name !== '') {
            $name .= '.';
        }
        $name .= $label;
    }

    if ($hasPointer) {
        $offset = $originalOffset;
    }

    return $name;
}

// ── Parsear respuesta DNS ─────────────────────────────────────
function parseDNSResponse(string $response, string $type): array {
    if (strlen($response) < 12) return ['error'=>true, 'values'=>[], 'raw'=>''];
    $rcode   = ord($response[3]) & 0x0F;
    $ancount = (ord($response[6]) << 8) | ord($response[7]);
    if ($rcode === 3) return ['error'=>false, 'values'=>[], 'raw'=>'NXDOMAIN'];
    if ($rcode !== 0) return ['error'=>true,  'values'=>[], 'raw'=>"RCODE:$rcode"];
    if ($ancount === 0) return ['error'=>false,'values'=>[], 'raw'=>'NODATA'];

    $values = [];
    $offset = 12;

    // Saltar sección de preguntas usando el decodificador
    decodeDNSName($response, $offset);
    $offset += 4; // QTYPE (2 bytes) + QCLASS (2 bytes)

    for ($i = 0; $i < $ancount && $offset < strlen($response); $i++) {
        // Saltar el nombre del registro usando el decodificador
        decodeDNSName($response, $offset);

        if ($offset + 10 > strlen($response)) break;
        $rrtype = (ord($response[$offset]) << 8) | ord($response[$offset+1]);
        $rdlen  = (ord($response[$offset+8]) << 8) | ord($response[$offset+9]);
        $offset += 10;
        if ($offset + $rdlen > strlen($response)) break;
        
        $rdata = substr($response, $offset, $rdlen);
        $rdataOffset = $offset; // Guardamos el offset donde empieza el RDATA
        $offset += $rdlen;

        switch ($rrtype) {
            case 1:  
                if ($rdlen === 4) {
                    $values[] = implode('.', array_map('ord', str_split($rdata)));
                }
                break;
            case 28: 
                if ($rdlen === 16) {
                    $p = []; 
                    for ($j = 0; $j < 16; $j += 2) {
                        $p[] = dechex((ord($rdata[$j]) << 8) | ord($rdata[$j+1]));
                    }
                    $values[] = implode(':', $p);
                } 
                break;
            case 15: 
                if ($rdlen > 2) {
                    $prio = (ord($rdata[0]) << 8) | ord($rdata[1]);
                    $tmpOffset = $rdataOffset + 2;
                    $exchange = decodeDNSName($response, $tmpOffset);
                    if ($exchange !== '') {
                        $values[] = "$prio $exchange";
                    }
                }
                break;
            case 2: case 5: // NS, CNAME
                $tmpOffset = $rdataOffset;
                $name = decodeDNSName($response, $tmpOffset);
                if ($name !== '') {
                    $values[] = $name;
                }
                break;
            case 6: // SOA
                $tmpOffset = $rdataOffset;
                $mname = decodeDNSName($response, $tmpOffset);
                $rname = decodeDNSName($response, $tmpOffset);
                if ($tmpOffset + 20 <= $offset) {
                    $serial   = (ord($response[$tmpOffset]) << 24) | (ord($response[$tmpOffset+1]) << 16) | (ord($response[$tmpOffset+2]) << 8) | ord($response[$tmpOffset+3]);
                    $refresh  = (ord($response[$tmpOffset+4]) << 24) | (ord($response[$tmpOffset+5]) << 16) | (ord($response[$tmpOffset+6]) << 8) | ord($response[$tmpOffset+7]);
                    $retry    = (ord($response[$tmpOffset+8]) << 24) | (ord($response[$tmpOffset+9]) << 16) | (ord($response[$tmpOffset+10]) << 8) | ord($response[$tmpOffset+11]);
                    $expire   = (ord($response[$tmpOffset+12]) << 24) | (ord($response[$tmpOffset+13]) << 16) | (ord($response[$tmpOffset+14]) << 8) | ord($response[$tmpOffset+15]);
                    $minimum  = (ord($response[$tmpOffset+16]) << 24) | (ord($response[$tmpOffset+17]) << 16) | (ord($response[$tmpOffset+18]) << 8) | ord($response[$tmpOffset+19]);
                    $values[] = "$mname $rname $serial $refresh $retry $expire $minimum";
                } else {
                    $values[] = "$mname $rname";
                }
                break;
            case 16: 
                $txt = ''; 
                $p = 0;
                while ($p < strlen($rdata)) {
                    $l = ord($rdata[$p++]);
                    $txt .= substr($rdata, $p, $l);
                    $p += $l;
                }
                $values[] = $txt; 
                break;
        }
    }
    sort($values); // Ordenar para comparación consistente
    return ['error'=>false, 'values'=>$values, 'raw'=>implode(' · ', $values)?:'NODATA'];
}

// ── Consultas en paralelo con stream_select ───────────────────
$packet  = buildDNSQuery($domain, $type);
$sockets = [];
$meta    = [];
$timeout = 3; // segundos por servidor

// Abrir todos los sockets NON-BLOCKING a la vez
foreach ($DNS_SERVERS as $idx => $srv) {
    $sock = @stream_socket_client("udp://{$srv['ip']}:53", $errno, $errstr, 1,
        STREAM_CLIENT_CONNECT | STREAM_CLIENT_ASYNC_CONNECT);
    if (!$sock) {
        $meta[$idx] = ['sent'=>false, 'start'=>microtime(true)];
        continue;
    }
    stream_set_blocking($sock, false);
    @fwrite($sock, $packet);
    $sockets[$idx]    = $sock;
    $meta[$idx]       = ['sent'=>true, 'start'=>microtime(true), 'sock'=>$sock];
}

// Recoger respuestas con stream_select
$results   = [];
$deadline  = microtime(true) + $timeout;
$pending   = $sockets;

while (!empty($pending) && microtime(true) < $deadline) {
    $read  = array_values($pending);
    $write = $except = null;
    $remaining = max(0.05, $deadline - microtime(true));
    $sec  = (int)$remaining;
    $usec = (int)(($remaining - $sec) * 1e6);

    $n = @stream_select($read, $write, $except, $sec, $usec);
    if ($n === false || $n === 0) break;

    foreach ($read as $sock) {
        $idx = array_search($sock, $pending);
        if ($idx === false) continue;

        $data = @fread($sock, 512);
        $ms   = round((microtime(true) - $meta[$idx]['start']) * 1000);
        @fclose($sock);
        unset($pending[$idx]);

        $parsed       = parseDNSResponse($data ?: '', $type);
        $results[$idx] = array_merge($parsed, ['ms' => $ms]);
    }
}

// Cerrar los que quedaron sin responder (timeout)
foreach ($pending as $idx => $sock) {
    @fclose($sock);
    $results[$idx] = ['error'=>true, 'values'=>[], 'raw'=>'', 'ms'=>$timeout*1000];
}

// Sockets que no se pudieron abrir
foreach ($DNS_SERVERS as $idx => $srv) {
    if (!isset($results[$idx])) {
        $results[$idx] = ['error'=>true, 'values'=>[], 'raw'=>'', 'ms'=>0];
    }
}

// ── Armar respuesta final ─────────────────────────────────────
$queryResults = [];
foreach ($DNS_SERVERS as $idx => $srv) {
    $r      = $results[$idx];
    $status = $r['error'] ? 'error' : ($r['raw']==='NXDOMAIN' ? 'nxdomain' : (empty($r['values']) ? 'nodata' : 'ok'));
    $queryResults[] = [
        'server'   => $srv['name'],
        'ip'       => $srv['ip'],
        'location' => $srv['location'],
        'flag'     => $srv['flag'],
        'values'   => $r['values'],
        'raw'      => $r['raw'],
        'error'    => $r['error'],
        'ms'       => $r['ms'],
        'status'   => $status,
    ];
}

// Consistencia: comparar valores ordenados (ya ordenados en parseDNSResponse)
$okResults    = array_filter($queryResults, fn($r) => $r['status'] === 'ok');
$allValues    = array_unique(array_map(fn($r) => implode(',', $r['values']), $okResults));
$consistent   = count($allValues) <= 1;
$propagated   = count($okResults);
$total        = count($queryResults);
$totalMs      = round((microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']) * 1000);

echo json_encode([
    'domain'     => $domain,
    'type'       => $type,
    'propagated' => $propagated,
    'total'      => $total,
    'consistent' => $consistent,
    'pct'        => $total > 0 ? round($propagated / $total * 100) : 0,
    'total_ms'   => $totalMs,
    'results'    => $queryResults,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>
