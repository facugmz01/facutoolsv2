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

// Limpiar URLs completas
$domain = preg_replace('#^https?://#', '', $domain);
$domain = explode('/', $domain)[0];
$domain = explode('?', $domain)[0];
$domain = rtrim($domain, '.');

if (!preg_match('/^([a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,}$/', $domain)) {
    http_response_code(400);
    echo json_encode(['error' => 'Dominio inválido: ' . htmlspecialchars($domain)]);
    exit;
}

// ── Detectar si es dominio .ar ────────────────────────────────
function isArDomain(string $domain): bool {
    return preg_match('/\.ar$/i', $domain) === 1;
}

// ── Consultar RDAP ────────────────────────────────────────────
function rdapQuery(string $url): array {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,   // rdap.org usa 302 redirect
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_HTTPHEADER     => ['Accept: application/rdap+json, application/json'],
        CURLOPT_USERAGENT      => 'IPScope/1.0 (RDAP lookup tool)',
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error) return ['_error' => 'Error de conexión: ' . $error, '_code' => 0];
    if ($httpCode === 404) return ['_error' => 'Dominio no encontrado en el registro.', '_code' => 404];
    if ($httpCode !== 200) return ['_error' => "El servidor RDAP respondió con código $httpCode.", '_code' => $httpCode];

    $data = json_decode($response, true);
    if (!$data) return ['_error' => 'Respuesta inválida del servidor RDAP.', '_code' => $httpCode];

    return $data;
}

// ── Parsear vCard ─────────────────────────────────────────────
function parseVcard(array $vcardArray): array {
    $result = [];
    if (empty($vcardArray[1]) || !is_array($vcardArray[1])) return $result;

    foreach ($vcardArray[1] as $prop) {
        if (!is_array($prop) || count($prop) < 4) continue;
        [$name, $params, $type, $value] = $prop;

        switch ($name) {
            case 'fn':   $result['name']  = $value; break;
            case 'org':  $result['org']   = is_array($value) ? implode(', ', $value) : $value; break;
            case 'email':$result['email'] = $value; break;
            case 'tel':  $result['tel']   = $value; break;
            case 'adr':
                if (is_array($value)) {
                    $parts = array_filter(array_slice($value, 2));
                    $result['address'] = implode(', ', $parts);
                } else {
                    $result['address'] = $value;
                }
                break;
        }
    }
    return $result;
}

// ── Parsear entidades ─────────────────────────────────────────
function parseEntities(array $entities): array {
    $result = [];
    foreach ($entities as $entity) {
        $roles   = $entity['roles'] ?? [];
        $vcard   = isset($entity['vcardArray']) ? parseVcard($entity['vcardArray']) : [];
        $handle  = $entity['handle'] ?? null;
        $pubId   = null;

        // Buscar publicIds (IANA ID del registrar)
        foreach ($entity['publicIds'] ?? [] as $pid) {
            if (($pid['type'] ?? '') === 'IANA Registrar ID') {
                $pubId = $pid['identifier'] ?? null;
            }
        }

        foreach ($roles as $role) {
            $result[$role] = array_filter([
                'handle'   => $handle,
                'iana_id'  => $pubId,
                'name'     => $vcard['name']    ?? null,
                'org'      => $vcard['org']     ?? null,
                'email'    => $vcard['email']   ?? null,
                'tel'      => $vcard['tel']     ?? null,
                'address'  => $vcard['address'] ?? null,
            ]);
        }
    }
    return $result;
}

// ── Parsear fechas de eventos ─────────────────────────────────
function parseEvents(array $events): array {
    $dates = [];
    foreach ($events as $event) {
        $action = $event['eventAction'] ?? '';
        $date   = $event['eventDate']   ?? '';
        if ($date) {
            $dt = DateTime::createFromFormat(DateTime::ATOM, $date)
               ?: DateTime::createFromFormat('Y-m-d\TH:i:s\Z', $date);
            $dates[$action] = $dt ? $dt->format('Y-m-d H:i:s') . ' UTC' : $date;
        }
    }
    return $dates;
}

// ── Parsear estado EPP ────────────────────────────────────────
function parseStatus(array $statuses): array {
    $labels = [
        'active'                          => ['Activo',                       'ok'],
        'inactive'                        => ['Inactivo',                     'warn'],
        'client delete prohibited'        => ['Borrado bloqueado (cliente)',   'ok'],
        'client transfer prohibited'      => ['Transferencia bloqueada',       'ok'],
        'client update prohibited'        => ['Actualización bloqueada',       'ok'],
        'client hold'                     => ['En espera (cliente)',           'warn'],
        'server delete prohibited'        => ['Borrado bloqueado (servidor)',  'ok'],
        'server transfer prohibited'      => ['Transferencia bloqueada (srv)', 'ok'],
        'server update prohibited'        => ['Actualización bloqueada (srv)', 'ok'],
        'server hold'                     => ['En espera (servidor)',          'warn'],
        'pending delete'                  => ['Pendiente de borrado',          'danger'],
        'pending restore'                 => ['Pendiente de restauración',     'warn'],
        'pending transfer'                => ['Transferencia pendiente',       'warn'],
        'pending update'                  => ['Actualización pendiente',       'warn'],
        'pending create'                  => ['Creación pendiente',            'warn'],
        'redemption period'               => ['Período de redención',          'danger'],
        'add period'                      => ['Período de alta',               'ok'],
        'auto renew period'               => ['Renovación automática',         'ok'],
        'transfer period'                 => ['En transferencia',              'warn'],
    ];

    return array_map(function ($s) use ($labels) {
        $lower = strtolower($s);
        return [
            'raw'    => $s,
            'label'  => $labels[$lower][0] ?? $s,
            'type'   => $labels[$lower][1] ?? 'dim',
        ];
    }, $statuses);
}

// ── Calcular días hasta vencimiento ──────────────────────────
function daysUntilExpiry(string $expiryStr): ?int {
    $clean = explode(' ', str_replace('T', ' ', $expiryStr))[0]; // solo "Y-m-d", soporta ISO 8601
    $expiry = DateTime::createFromFormat('Y-m-d', $clean);
    if (!$expiry) return null;
    $now = new DateTime();
    $diff = $now->diff($expiry);
    return $diff->invert ? -$diff->days : $diff->days;
}

// ── Ejecutar consulta ─────────────────────────────────────────
$isAr   = isArDomain($domain);
$source = $isAr ? 'NIC Argentina (RDAP)' : 'RDAP Bootstrap (rdap.org)';
$rdapURL = $isAr
    ? "https://rdap.nic.ar/domain/{$domain}"
    : "https://rdap.org/domain/{$domain}";

$raw = rdapQuery($rdapURL);

if (isset($raw['_error'])) {
    // ── Failover a DOMSCAN ────────────────────────────────────────
    $apiKey = defined('DOMSCAN_API_KEY') ? DOMSCAN_API_KEY : (getenv('DOMSCAN_API_KEY') ?: '');
    $domscanSuccess = false;
    
    if (!empty($apiKey)) {
        $dsUrl = "https://api.domscan.net/v1/whois?domain=" . urlencode($domain);
        $ch = curl_init($dsUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: application/json',
            'Authorization: Bearer ' . $apiKey
        ]);
        curl_setopt($ch, CURLOPT_TIMEOUT, 12);
        $dsResponse = curl_exec($ch);
        $dsHttpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($dsHttpCode === 200 && $dsResponse) {
            $dsData = json_decode($dsResponse, true);
            
            // Desempaquetar respuesta si Domscan la envuelve en un objeto 'data'
            if (isset($dsData['data'])) $dsData = $dsData['data'];
            
            if ($dsData && empty($dsData['error'])) {
                $domscanSuccess = true;
                
                $whoisData = $dsData['whois'] ?? $dsData;
                $nameservers = $whoisData['nameservers'] ?? $dsData['nameservers'] ?? [];
                if (!is_array($nameservers)) $nameservers = [$nameservers];
                
                $events = [];
                if (!empty($whoisData['created_date'])) $events['registration'] = $whoisData['created_date'];
                elseif (!empty($whoisData['creation_date'])) $events['registration'] = $whoisData['creation_date'];
                
                if (!empty($whoisData['updated_date'])) $events['last changed'] = $whoisData['updated_date'];
                
                if (!empty($whoisData['expires_date'])) $events['expiration'] = $whoisData['expires_date'];
                elseif (!empty($whoisData['expiration_date'])) $events['expiration'] = $whoisData['expiration_date'];
                
                $daysExpiry = isset($events['expiration']) ? daysUntilExpiry($events['expiration']) : null;
                
                $entities = [];
                if (!empty($whoisData['registrar'])) {
                    $entities['registrar'] = [
                        'name' => is_array($whoisData['registrar']) ? ($whoisData['registrar']['name'] ?? '') : $whoisData['registrar']
                    ];
                }
                
                $statuses = [];
                if (!empty($whoisData['status'])) {
                    $stList = is_array($whoisData['status']) ? $whoisData['status'] : [$whoisData['status']];
                    $statuses = parseStatus($stList);
                }
                
                $raw = [
                    'source'     => 'DOMSCAN.net (Failover)',
                    'rdap_url'   => $dsUrl,
                    'handle'     => null,
                    'ldhName'    => $domain,
                    'status'     => $statuses,
                    'nameservers'=> $nameservers,
                    'dnssec'     => $whoisData['dnssec'] ?? false,
                    'events'     => $events,
                    'days_expiry'=> $daysExpiry,
                    'entities'   => $entities,
                ];
            }
        }
    }

    if (!$domscanSuccess) {
        http_response_code($raw['_code'] === 404 ? 404 : 502);
        echo json_encode(['error' => $raw['_error'], 'domain' => $domain, 'source' => $source]);
        exit;
    }
} else {
    // ── Parsear respuesta RDAP ─────────────────────────────────────────
    $raw['nameservers'] = array_map(
        fn($ns) => strtolower($ns['ldhName'] ?? $ns['unicodeName'] ?? ''),
        $raw['nameservers'] ?? []
    );

    $raw['entities'] = parseEntities($raw['entities'] ?? []);
    $raw['events']   = parseEvents($raw['events']   ?? []);
    $raw['status']   = parseStatus($raw['status']   ?? []);

    $raw['dnssec'] = $raw['secureDNS']['delegationSigned'] ?? false;

    // Días hasta vencimiento
    $raw['days_expiry'] = null;
    if (isset($raw['events']['expiration'])) {
        $raw['days_expiry'] = daysUntilExpiry($raw['events']['expiration']);
    }
    
    $raw['source']   = $source;
    $raw['rdap_url'] = $rdapURL;
}

echo json_encode([
    'domain'     => $domain,
    'source'     => $raw['source'] ?? $source,
    'is_ar'      => $isAr,
    'rdap_url'   => $raw['rdap_url'] ?? $rdapURL,
    'handle'     => $raw['handle']  ?? null,
    'ldhName'    => $raw['ldhName'] ?? $domain,
    'status'     => $raw['status'] ?? [],
    'nameservers'=> $raw['nameservers'] ?? [],
    'dnssec'     => $raw['dnssec'] ?? false,
    'events'     => $raw['events'] ?? [],
    'days_expiry'=> $raw['days_expiry'] ?? null,
    'entities'   => $raw['entities'] ?? [],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>
