<?php
require_once __DIR__ . '/config.php';

header("Content-Type: application/json");
header("Cache-Control: no-store, no-cache, private");

$ip = $_GET['ip'] ?? '';
if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
    echo json_encode(['error' => 'IP inválida (solo IPv4 soportada)']);
    exit;
}

// Ignorar rangos privados
if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
    echo json_encode(['private' => true, 'note' => 'La IP es privada o reservada (LAN). Las listas negras no aplican.']);
    exit;
}

// Invertir la IP para consultas DNSBL
$rev = implode('.', array_reverse(explode('.', $ip)));

// Colección de listas negras a consultar (mismas 32 que FacuTools / IPScope)
$lists = [
    'zen.spamhaus.org'         => ['name' => 'Spamhaus ZEN', 'cat' => 'spamhaus', 'url' => 'https://www.spamhaus.org/zen/', 'dqs' => 'zen'],
    'sbl.spamhaus.org'         => ['name' => 'Spamhaus SBL', 'cat' => 'spamhaus', 'url' => 'https://www.spamhaus.org/sbl/', 'dqs' => 'sbl'],
    'xbl.spamhaus.org'         => ['name' => 'Spamhaus XBL', 'cat' => 'spamhaus', 'url' => 'https://www.spamhaus.org/xbl/', 'dqs' => 'xbl'],
    'pbl.spamhaus.org'         => ['name' => 'Spamhaus PBL', 'cat' => 'spamhaus', 'url' => 'https://www.spamhaus.org/pbl/', 'dqs' => 'pbl'],
    'b.barracudacentral.org'   => ['name' => 'Barracuda BRBL', 'cat' => 'enterprise', 'url' => 'http://www.barracudacentral.org/rbl'],
    'dnsbl-1.uceprotect.net'   => ['name' => 'UCEProtect L1', 'cat' => 'enterprise', 'url' => 'http://www.uceprotect.net/'],
    'dnsbl-2.uceprotect.net'   => ['name' => 'UCEProtect L2', 'cat' => 'enterprise', 'url' => 'http://www.uceprotect.net/'],
    'dnsbl-3.uceprotect.net'   => ['name' => 'UCEProtect L3', 'cat' => 'enterprise', 'url' => 'http://www.uceprotect.net/'],
    'bl.spamcop.net'           => ['name' => 'SpamCop', 'cat' => 'spam', 'url' => 'https://www.spamcop.net/'],
    'psbl.surriel.com'         => ['name' => 'PSBL', 'cat' => 'spam', 'url' => 'https://psbl.surriel.com/'],
    'rbl.s5h.net'              => ['name' => 's5h.net', 'cat' => 'spam', 'url' => 'http://www.s5h.net/'],
    'bl.0spam.org'             => ['name' => '0spam BL', 'cat' => 'spam', 'url' => 'https://0spam.org/'],
    'rbl.0spam.org'            => ['name' => '0spam RBL', 'cat' => 'spam', 'url' => 'https://0spam.org/'],
    'spam.dnsbl.anonmails.de'  => ['name' => 'AnonMails', 'cat' => 'spam', 'url' => 'https://anonmails.de/'],
    'spambot.bls.digibase.ca'  => ['name' => 'Digibase Spambot', 'cat' => 'spam', 'url' => 'http://www.digibase.ca/'],
    'z.mailspike.net'          => ['name' => 'Mailspike Z', 'cat' => 'spam', 'url' => 'https://mailspike.net/'],
    'spamsources.fabel.dk'     => ['name' => 'Fabel Spamsources', 'cat' => 'spam', 'url' => 'https://spamsources.fabel.dk/'],
    'blacklist.woody.ch'       => ['name' => 'Woody Blacklist', 'cat' => 'spam', 'url' => 'https://blacklist.woody.ch/'],
    'spam.rbl.imp.ch'          => ['name' => 'IMP Spam RBL', 'cat' => 'spam', 'url' => 'https://imp.ch/'],
    'relays.nether.net'        => ['name' => 'Nether Relays', 'cat' => 'spam', 'url' => 'https://nether.net/'],
    'cbl.abuseat.org'          => ['name' => 'CBL (Abuseat)', 'cat' => 'botnet', 'url' => 'https://www.abuseat.org/'],
    'dnsbl.dronebl.org'        => ['name' => 'DroneBL', 'cat' => 'botnet', 'url' => 'https://dronebl.org/'],
    'drone.abuse.ch'           => ['name' => 'Abuse.ch Drone', 'cat' => 'botnet', 'url' => 'https://abuse.ch/'],
    'spam.abuse.ch'            => ['name' => 'Abuse.ch Spam', 'cat' => 'botnet', 'url' => 'https://abuse.ch/'],
    'combined.abuse.ch'        => ['name' => 'Abuse.ch Combined', 'cat' => 'botnet', 'url' => 'https://abuse.ch/'],
    'worm.rbl.imp.ch'          => ['name' => 'IMP Worm RBL', 'cat' => 'botnet', 'url' => 'https://imp.ch/'],
    'virus.rbl.jp'             => ['name' => 'VirusRBL Japan', 'cat' => 'botnet', 'url' => 'http://www.rbl.jp/'],
    'ips.backscatterer.org'    => ['name' => 'Backscatterer', 'cat' => 'backscatter', 'url' => 'http://www.backscatterer.org/'],
    'bogons.cymru.com'         => ['name' => 'Team Cymru Bogons', 'cat' => 'bogon', 'url' => 'https://team-cymru.com/'],
    'dyna.spamrats.com'        => ['name' => 'SpamRATS DYNA', 'cat' => 'spamrats', 'url' => 'https://www.spamrats.com/'],
    'noptr.spamrats.com'       => ['name' => 'SpamRATS NoPTR', 'cat' => 'spamrats', 'url' => 'https://www.spamrats.com/'],
    'spam.spamrats.com'        => ['name' => 'SpamRATS SPAM', 'cat' => 'spamrats', 'url' => 'https://www.spamrats.com/'],
];

// Spamhaus policy replies (open resolver / typo / rate limit) — NOT real listings.
$spamhausPolicyCodes = [
    '127.255.255.252' => true,
    '127.255.255.254' => true,
    '127.255.255.255' => true,
];

function isValidListingCode(string $code, array $policyCodes): bool {
    if ($code === '' || isset($policyCodes[$code])) {
        return false;
    }
    $parts = explode('.', $code);
    if (count($parts) !== 4) {
        return false;
    }
    foreach ($parts as $p) {
        if (!ctype_digit($p) || (int)$p > 255) {
            return false;
        }
    }
    $nums = array_map('intval', $parts);
    return $nums[0] === 127 && !($nums[1] === 255 && $nums[2] === 255);
}

function interpretListing(string $code, array $policyCodes): array {
    if (isset($policyCodes[$code]) || !isValidListingCode($code, $policyCodes)) {
        return ['listed' => false, 'error' => true, 'code' => $code];
    }
    return ['listed' => true, 'error' => false, 'code' => $code];
}

$spamratsKey = defined('SPAMRATS_KEY') ? SPAMRATS_KEY : (getenv('SPAMRATS_KEY') ?: '');
$dqsKey = defined('SPAMHAUS_DQS_KEY') ? SPAMHAUS_DQS_KEY : (getenv('SPAMHAUS_DQS_KEY') ?: '');
$abuseKey = defined('ABUSEIPDB_KEY') ? ABUSEIPDB_KEY : (getenv('ABUSEIPDB_KEY') ?: '');

$mh = curl_multi_init();
$curls = [];

// 1. DoH for free DNSBLs + Spamhaus DQS (when key present)
foreach ($lists as $host => $data) {
    if ($data['cat'] === 'spamrats') {
        continue; // local DNS + key, or skipped
    }
    if ($data['cat'] === 'spamhaus' && empty($dqsKey)) {
        continue; // public mirrors via local DNS below
    }

    if ($data['cat'] === 'spamhaus' && !empty($dqsKey)) {
        $zone = $data['dqs'] ?? explode('.', $host)[0];
        $qname = "$rev.$dqsKey.$zone.dq.spamhaus.net";
    } else {
        $qname = "$rev.$host";
    }

    $url = "https://cloudflare-dns.com/dns-query?name={$qname}&type=A";
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Accept: application/dns-json'],
        CURLOPT_TIMEOUT => 4
    ]);
    curl_multi_add_handle($mh, $ch);
    $curls[$host] = $ch;
}

// 2. AbuseIPDB in parallel
$chAbuse = null;
if ($abuseKey) {
    $chAbuse = curl_init("https://api.abuseipdb.com/api/v2/check?ipAddress=$ip");
    curl_setopt_array($chAbuse, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ["Key: $abuseKey", "Accept: application/json"],
        CURLOPT_TIMEOUT => 4
    ]);
    curl_multi_add_handle($mh, $chAbuse);
}

$running = null;
do {
    curl_multi_exec($mh, $running);
    curl_multi_select($mh);
} while ($running > 0);

$results = [];
$listedCount = 0;
$activeTotal = 0;

foreach ($lists as $host => $data) {
    $isListed = false;
    $ipCode = '';
    $err = false;
    $skipped = false;
    $skipReason = '';

    if ($data['cat'] === 'spamrats') {
        if (empty($spamratsKey)) {
            $skipped = true;
            $skipReason = 'missing_spamrats_key';
        } else {
            $qname = "$rev.$spamratsKey.$host";
            $records = @dns_get_record($qname, DNS_A);
            $activeTotal++;
            if ($records === false) {
                $err = true;
            } elseif (!empty($records)) {
                $ipCode = $records[0]['ip'] ?? '';
                $interp = interpretListing($ipCode, $spamhausPolicyCodes);
                $isListed = $interp['listed'];
                $err = $interp['error'];
                if ($isListed) $listedCount++;
            }
        }
    } elseif ($data['cat'] === 'spamhaus' && empty($dqsKey)) {
        $qname = "$rev.$host";
        $records = @dns_get_record($qname, DNS_A);
        $activeTotal++;
        if ($records === false) {
            $err = true;
        } elseif (!empty($records)) {
            $ipCode = $records[0]['ip'] ?? '';
            $interp = interpretListing($ipCode, $spamhausPolicyCodes);
            $isListed = $interp['listed'];
            $err = $interp['error'];
            if ($isListed) $listedCount++;
        }
    } else {
        $ch = $curls[$host];
        $res = curl_multi_getcontent($ch);
        curl_multi_remove_handle($mh, $ch);
        $activeTotal++;

        $err = true;
        if ($res && $json = json_decode($res, true)) {
            $err = false;
            if (($json['Status'] ?? -1) === 0 && !empty($json['Answer'])) {
                $ipCode = $json['Answer'][0]['data'] ?? '';
                $interp = interpretListing($ipCode, $spamhausPolicyCodes);
                $isListed = $interp['listed'];
                $err = $interp['error'];
                if ($isListed) $listedCount++;
            }
        }
    }

    $results[] = [
        'name' => $data['name'],
        'category' => $data['cat'],
        'url' => $data['url'],
        'listed' => $isListed,
        'error' => $err,
        'code' => $ipCode,
        'skipped' => $skipped,
        'skip_reason' => $skipReason,
    ];
}

$abuseData = null;
if ($chAbuse) {
    $res = curl_multi_getcontent($chAbuse);
    if ($res && $json = json_decode($res, true)) {
        if (isset($json['data'])) {
            $abuseData = [
                'score' => $json['data']['abuseConfidenceScore'],
                'totalReports' => $json['data']['totalReports'],
                'lastReportedAt' => $json['data']['lastReportedAt'],
            ];
        }
    }
    curl_multi_remove_handle($mh, $chAbuse);
}

curl_multi_close($mh);

echo json_encode([
    'private' => false,
    'clean' => $listedCount === 0,
    'total' => $activeTotal,
    'listed' => $listedCount,
    'dnsbl' => $results,
    'abuseipdb' => $abuseData,
    'fortiguard' => "https://www.fortiguard.com/search?q=$ip&engine=8",
    'keys' => [
        'abuseipdb' => (bool)$abuseKey,
        'spamrats' => (bool)$spamratsKey,
        'spamhaus_dqs' => (bool)$dqsKey,
    ],
]);
?>
