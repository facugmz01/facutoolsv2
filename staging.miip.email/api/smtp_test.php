<?php
require_once __DIR__ . '/config.php';

header("Content-Type: application/json");

$host = $_POST['host'] ?? '';
$port = (int)($_POST['port'] ?? 25);
$user = $_POST['user'] ?? '';
$pass = $_POST['pass'] ?? '';
$from = $_POST['from'] ?? '';
$to = $_POST['to'] ?? '';
$security = $_POST['security'] ?? 'auto'; // auto, ssl, tls, none

if (empty($host) || empty($port)) {
    http_response_code(400);
    echo json_encode(['error' => 'El servidor y el puerto son requeridos.']);
    exit;
}

$log = [];
$timeout = 10;
$heloDomain = $_SERVER['SERVER_NAME'] ?? 'localhost';

function addLog(&$log, $type, $msg) {
    $log[] = ['type' => $type, 'msg' => trim($msg), 'time' => date('H:i:s')];
}

function expectResponse($conn, &$log, $expectedCode = null) {
    $res = '';
    while ($str = fgets($conn, 515)) {
        $res .= $str;
        addLog($log, 'rx', $str);
        if (substr($str, 3, 1) == ' ') break;
    }
    if ($expectedCode && substr($res, 0, 3) != $expectedCode) {
        throw new Exception("Se esperaba código $expectedCode, se recibió: " . substr($res, 0, 3));
    }
    return $res;
}

function sendCommand($conn, &$log, $cmd, $maskLog = false) {
    $logCmd = $maskLog ? preg_replace('/(AUTH LOGIN\r\n).*/s', '$1[CONTRASEÑA OCULTA]', $cmd) : $cmd;
    if ($maskLog && !str_starts_with($cmd, 'AUTH')) { $logCmd = '********'; } // Para el base64 de pass
    addLog($log, 'tx', $logCmd);
    fwrite($conn, $cmd . "\r\n");
}

try {
    $protocol = ($security === 'ssl' || $port === 465) ? 'ssl://' : '';
    addLog($log, 'info', "Conectando a {$protocol}{$host}:{$port}...");
    
    $conn = @fsockopen($protocol . $host, $port, $errno, $errstr, $timeout);
    if (!$conn) { throw new Exception("Error de conexión: $errstr ($errno)"); }
    
    stream_set_timeout($conn, $timeout);
    expectResponse($conn, $log, '220');
    
    sendCommand($conn, $log, "EHLO {$heloDomain}");
    $ehloRes = expectResponse($conn, $log, '250');
    
    if (($security === 'tls' || $security === 'auto') && $port !== 465 && stripos($ehloRes, 'STARTTLS') !== false) {
        sendCommand($conn, $log, "STARTTLS");
        expectResponse($conn, $log, '220');
        if (!stream_socket_enable_crypto($conn, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            throw new Exception("Fallo al negociar TLS");
        }
        addLog($log, 'info', "Túnel TLS establecido correctamente");
        sendCommand($conn, $log, "EHLO {$heloDomain}");
        expectResponse($conn, $log, '250');
    }
    
    if (!empty($user) && !empty($pass)) {
        sendCommand($conn, $log, "AUTH LOGIN");
        expectResponse($conn, $log, '334');
        sendCommand($conn, $log, base64_encode($user));
        expectResponse($conn, $log, '334');
        sendCommand($conn, $log, base64_encode($pass), true); // true = Ocultar contraseña en el log del frontend
        expectResponse($conn, $log, '235'); // 235 Auth successful
        addLog($log, 'info', "Autenticación exitosa para {$user}");
    }
    
    if (!empty($from)) { sendCommand($conn, $log, "MAIL FROM:<$from>"); expectResponse($conn, $log, '250'); }
    if (!empty($to)) { sendCommand($conn, $log, "RCPT TO:<$to>"); expectResponse($conn, $log, '250'); }
    
    sendCommand($conn, $log, "QUIT");
    fclose($conn);
    echo json_encode(['success' => true, 'log' => $log]);
} catch (Exception $e) {
    addLog($log, 'error', $e->getMessage());
    if (isset($conn) && is_resource($conn)) { @fclose($conn); }
    echo json_encode(['success' => false, 'error' => $e->getMessage(), 'log' => $log]);
}