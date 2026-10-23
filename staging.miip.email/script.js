/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
window.onload = function () {
    cargarDatosIP('');

    document.getElementById('ipInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); buscarIP(); }
    });

    document.getElementById('dnsInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); buscarDNS(); }
    });

    document.getElementById('whoisInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); buscarWhois(); }
    });

    document.getElementById('propInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); buscarProp(); }
    });

    const macInput = document.getElementById('macInput');
    if (macInput) {
        macInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); buscarMAC(); }
        });
    }
    
    const ipCalcInput = document.getElementById('ipCalcInput');
    if (ipCalcInput) {
        ipCalcInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); calculateIP(); }
        });
    }

    // Keyboard navigation for tabs
    const tabList = document.querySelector('[role="tablist"]');
    if (tabList) {
        tabList.addEventListener('keydown', e => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
                const currentIndex = tabs.findIndex(t => t.classList.contains('active'));
                let nextIndex = e.key === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1;
                if (nextIndex >= tabs.length) nextIndex = 0;
                if (nextIndex < 0) nextIndex = tabs.length - 1;
                tabs[nextIndex].click();
                tabs[nextIndex].focus();
            }
        });
    }
    
    initHistory();
    inyectarModoOscuroModerno();
};

/* ══════════════════════════════════════════════════
   MODO OSCURO MODERNO (Inyectado)
══════════════════════════════════════════════════ */
function inyectarModoOscuroModerno() {
    if (document.getElementById('dark-theme-modern')) return;
    
    const style = document.createElement('style');
    style.id = 'dark-theme-modern';
    style.innerHTML = `
        :root {
            --bg: #09090b;
            --bg2: #121214;
            --border: #27272a;
            --text: #fafafa;
            --text-dim: #a1a1aa;
            --accent: #3b82f6;
            --accent-hover: #2563eb;
            --accent2: #8b5cf6;
            --danger: #ef4444;
            --warn: #f59e0b;
            --ok: #10b981;
            --radius: 12px;
        }
        body {
            background-color: var(--bg) !important;
            color: var(--text) !important;
        }
        .card {
            background: var(--bg2) !important;
            border: 1px solid var(--border) !important;
            border-radius: var(--radius) !important;
            box-shadow: 0 8px 30px rgba(0,0,0,0.5) !important;
        }
        .card-header {
            border-bottom: 1px solid var(--border) !important;
            background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%) !important;
            border-radius: var(--radius) var(--radius) 0 0 !important;
        }
        .data-row { border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important; }
        .data-row:last-child { border-bottom: none !important; }
        
        /* Inputs y Botones */
        input[type="text"], input[type="number"], select {
            background: #000000 !important;
            border: 1px solid var(--border) !important;
            color: var(--text) !important;
            border-radius: 8px !important;
            transition: all 0.2s ease;
        }
        input[type="text"]:focus, select:focus {
            border-color: var(--accent) !important;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2) !important;
            outline: none !important;
        }
        button:not(.btn-copy):not(.history-remove) {
            border-radius: 8px !important;
            transition: transform 0.1s, filter 0.2s !important;
        }
        button:active { transform: scale(0.97); }
        
        /* Badges rediseñados */
        .badge { border-radius: 6px !important; font-weight: 600 !important; padding: 4px 8px !important; }
        .b-ok { background: rgba(16, 185, 129, 0.15) !important; color: var(--ok) !important; border: 1px solid rgba(16, 185, 129, 0.3) !important; }
        .b-danger { background: rgba(239, 68, 68, 0.15) !important; color: var(--danger) !important; border: 1px solid rgba(239, 68, 68, 0.3) !important; }
        .b-warn { background: rgba(245, 158, 11, 0.15) !important; color: var(--warn) !important; border: 1px solid rgba(245, 158, 11, 0.3) !important; }
        .b-dim { background: rgba(161, 161, 170, 0.15) !important; color: var(--text-dim) !important; border: 1px solid rgba(161, 161, 170, 0.3) !important; }
        
        /* Scrollbars oscuros */
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }
    `;
    document.head.appendChild(style);
}

/* ══════════════════════════════════════════════════
   API HELPER & STATE MANAGER
══════════════════════════════════════════════════ */
async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    const isJson = res.headers.get('content-type')?.includes('application/json');
    
    if (!res.ok) {
        if (isJson) {
            const errData = await res.json();
            throw new Error(errData.error || errData.message || `Error HTTP ${res.status}`);
        }
        throw new Error(`Error HTTP ${res.status}`);
    }
    return isJson ? await res.json() : await res.text();
}

function toggleLoadingState(els, isLoading, isSuccess = false, errMsg = '') {
    const resEl = els.res ? document.getElementById(els.res) : null;
    const errEl = els.err ? document.getElementById(els.err) : null;
    const loadEl = els.load ? document.getElementById(els.load) : null;
    
    if (isLoading) {
        if (resEl) resEl.classList.add('hidden');
        if (errEl) errEl.classList.add('hidden');
        if (loadEl) loadEl.classList.remove('hidden');
    } else {
        if (loadEl) loadEl.classList.add('hidden');
        if (isSuccess && resEl) {
            resEl.classList.remove('hidden');
            void resEl.offsetWidth;
            resEl.classList.add('visible');
        } else if (errEl) {
            errEl.textContent = '⚠ ' + errMsg;
            errEl.classList.remove('hidden');
        }
    }
}

/* ══════════════════════════════════════════════════
   UX & UI HELPERS (Toasts & Copy)
══════════════════════════════════════════════════ */
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = type === 'success' ? `✓ ${esc(msg)}` : `⚠ ${esc(msg)}`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fadeOut');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function copyText(text, btn) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copiado al portapapeles');
        if (btn) {
            const oldHtml = btn.innerHTML;
            btn.innerHTML = '✓';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = oldHtml;
                btn.classList.remove('copied');
            }, 2000);
        }
    }).catch(err => {
        showToast('Error al copiar', 'error');
        console.error('Copy failed', err);
    });
}

function copyBtnHtml(text) {
    if (!text || text === 'N/A') return '';
    const safeText = String(text).replace(/'/g, "\\'").replace(/"/g, "&quot;");
    return `<button class="btn-copy" onclick="copyText('${safeText}', this)" aria-label="Copiar" title="Copiar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;
}

/* ══════════════════════════════════════════════════
   TAB SWITCHING (with a11y)
══════════════════════════════════════════════════ */
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => {
        const isActive = t.dataset.tab === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive);
        t.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    
    ['ip', 'dns', 'whois', 'prop', 'ransom', 'mac', 'passgen', 'smtp', 'ipcalc'].forEach(t => {
        const panel = document.getElementById('tab-' + t);
        if (!panel) return;
        if (t === tab) {
            panel.classList.remove('hidden');
            setTimeout(() => panel.style.opacity = 1, 10);
            // Autofocus input
            const input = document.getElementById(t + 'Input');
            if (input) input.focus();
            
            // Auto-load ransomware if empty
            if (t === 'ransom' && typeof ransomwareData !== 'undefined' && ransomwareData.length === 0) {
                cargarRansomware();
            }
        } else {
            panel.style.opacity = 0;
            setTimeout(() => panel.classList.add('hidden'), 200);
        }
    });
}

/* ══════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════ */
function esc(val) {
    if (val === null || val === undefined) return 'N/A';
    const d = document.createElement('div');
    d.textContent = String(val);
    return d.innerHTML;
}

function fila(label, valor, cls = '') {
    return `<div class="data-row">
        <span class="data-label">${label}</span>
        <span class="data-val ${cls}">${valor}</span>
    </div>`;
}

function getCorrectLocalTime(currentTimeStr, tzName) {
    if (!currentTimeStr) return 'N/A';
    try {
        // 1. Reemplazar la zona horaria del final (e.g., -03:00 o +02:00) por 'Z'
        // para tratar la hora base como UTC.
        let cleanTime = currentTimeStr.replace(/[-+]\d{2}:\d{2}$/, 'Z');
        // 2. Limpiar microsegundos si existen (reducir a un máximo de 3 dígitos de milisegundos)
        cleanTime = cleanTime.replace(/(\.\d{3})\d+/, '$1');
        
        const t = new Date(cleanTime);
        if (!isNaN(t)) {
            // Intentar formatear usando Intl.DateTimeFormat con la zona horaria provista
            if (tzName) {
                try {
                    const formatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: tzName,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                    const parts = formatter.formatToParts(t);
                    const h = parts.find(p => p.type === 'hour')?.value;
                    const m = parts.find(p => p.type === 'minute')?.value;
                    const s = parts.find(p => p.type === 'second')?.value;
                    if (h && m && s) {
                        return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
                    }
                } catch (e) {
                    console.error("Error en Intl.DateTimeFormat con timezone, usando toLocaleTimeString:", e);
                }
            }
            
            // Fallback usando toLocaleTimeString simple
            const formatted = t.toLocaleTimeString('es-AR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            if (formatted && formatted.includes(':')) return formatted;
        }
    } catch (e) {
        console.error("Fallo parsing / formatting de hora:", e);
    }
    
    // Fallback matemático ultra-robusto:
    try {
        const match = currentTimeStr.match(/T(\d{2}):(\d{2}):(\d{2})/);
        const offsetMatch = currentTimeStr.match(/([-+])(\d{2}):(\d{2})$/);
        if (match && offsetMatch) {
            let h = parseInt(match[1], 10);
            let m = parseInt(match[2], 10);
            let s = parseInt(match[3], 10);
            const sign = offsetMatch[1] === '+' ? 1 : -1;
            const offsetH = parseInt(offsetMatch[2], 10);
            const offsetM = parseInt(offsetMatch[3], 10);
            
            h += sign * offsetH;
            m += sign * offsetM;
            if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
            else if (m < 0) { h += Math.floor(m / 60) - 1; m = (m % 60 + 60) % 60; }
            h = (h % 24 + 24) % 24;
            const pad = num => String(num).padStart(2, '0');
            return `${pad(h)}:${pad(m)}:${pad(s)}`;
        }
    } catch (err) {
        console.error("Fallo fallback matemático:", err);
    }
    
    const rawMatch = currentTimeStr.match(/T(\d{2}:\d{2}:\d{2})/);
    return rawMatch ? rawMatch[1] : currentTimeStr;
}

function getCorrectLocalTimeHM(currentTimeStr, tzName) {
    const fullTime = getCorrectLocalTime(currentTimeStr, tzName);
    if (fullTime === 'N/A') return 'N/A';
    return fullTime.substring(0, 5);
}

function mostrarEstado(estado) {
    ['loading', 'resultado', 'error'].forEach(id => {
        const el = document.getElementById(id);
        if (id === estado) {
            el.classList.remove('hidden');
            if (id === 'resultado') {
                // Request reflow and add visible class to trigger CSS animations
                void el.offsetWidth;
                el.classList.add('visible');
            }
        } else {
            el.classList.add('hidden');
            if (id === 'resultado') el.classList.remove('visible');
        }
    });
}

/* ══════════════════════════════════════════════════
   IP LOOKUP
══════════════════════════════════════════════════ */
function buscarIP() {
    const ip = document.getElementById('ipInput').value.trim();
    if (ip) {
        saveHistory('ip', ip);
        cargarDatosIP(ip);
    }
}

function miIP() {
    document.getElementById('ipInput').value = '';
    cargarDatosIP('');
}

function cargarDatosIP(ip) {
    mostrarEstado('loading');
    const url = ip ? `api/ipdata.php?ip=${encodeURIComponent(ip)}` : 'api/ipdata.php';

    apiFetch(url).then(data => {
        renderizar(data);
        mostrarEstado('resultado');
    }).catch(err => {
        document.getElementById('error').textContent = '⚠ ' + err.message;
        mostrarEstado('error');
    });
}

/* ── IP Render ────────────────────────────────── */
let _currentIP = '';

function renderizar(d) {
    _currentIP = d.ip || '';

    document.getElementById('btnBlacklist').textContent = 'Verificar';
    document.getElementById('btnBlacklist').disabled = false;
    document.getElementById('blSummary').classList.add('hidden');
    document.getElementById('secBlacklist').innerHTML = blIdleHTML();

    renderHero(d);
    renderUbicacion(d);
    renderRed(d);
    renderHorario(d);
    renderMoneda(d);
    renderAmenazas(d);
    renderMapa(d);
    initCopyCards();
}

function blIdleHTML() {
    return `<div class="bl-idle">
        <p>Consultá 28 listas DNSBL públicas + AbuseIPDB + FortiGuard</p>
        <div class="bl-sources">
            <span class="bl-tag bl-tag-spamhaus">Spamhaus ZEN/SBL/XBL/PBL</span>
            <span class="bl-tag">Barracuda</span>
            <span class="bl-tag">UCEProtect L1/L2/L3</span>
            <span class="bl-tag">SpamCop</span>
            <span class="bl-tag">PSBL</span>
            <span class="bl-tag">0spam</span>
            <span class="bl-tag">Mailspike</span>
            <span class="bl-tag">AnonMails</span>
            <span class="bl-tag">Woody</span>
            <span class="bl-tag">IMP RBL</span>
            <span class="bl-tag">Nether Relays</span>
            <span class="bl-tag">DroneBL</span>
            <span class="bl-tag">CBL</span>
            <span class="bl-tag">Abuse.ch</span>
            <span class="bl-tag">Backscatterer</span>
            <span class="bl-tag">Team Cymru</span>
            <span class="bl-tag">AbuseIPDB</span>
            <span class="bl-tag bl-tag-forti">FortiGuard ↗</span>
        </div>
    </div>`;
}

function renderHero(d) {
    document.getElementById('heroFlag').textContent = d.emoji_flag || '';
    document.getElementById('heroIP').innerHTML = esc(d.ip) + copyBtnHtml(d.ip);
    const partes = [d.city, d.region, d.country_name].filter(Boolean);
    document.getElementById('heroLocation').textContent = partes.join(', ');

    const time = d.time_zone?.current_time;
    const timeEl = document.getElementById('heroTime');
    if (time) {
        const hora = getCorrectLocalTimeHM(time, d.time_zone?.name);
        timeEl.innerHTML = `<div class="time-val">${hora}</div><div class="time-label">${esc(d.time_zone?.name)}</div>`;
    } else {
        timeEl.innerHTML = '';
    }
}

function renderUbicacion(d) {
    const euBadge = d.is_eu
        ? `<span class="badge b-ok">Unión Europea</span>`
        : `<span class="badge b-dim">No-UE</span>`;
    const flag = d.flag
        ? `<img src="${esc(d.flag)}" style="height:14px;vertical-align:middle;margin-right:5px;">${esc(d.country_name)}`
        : esc(d.country_name);

    document.getElementById('secUbicacion').innerHTML =
        fila('IP', esc(d.ip) + copyBtnHtml(d.ip), 'highlight accent') +
        fila('País', flag) +
        fila('Código de país', esc(d.country_code)) +
        fila('Continente', `${esc(d.continent_name)} (${esc(d.continent_code)})`) +
        fila('Región', `${esc(d.region)}${d.region_code ? ` <span style="color:var(--text-dim)">(${esc(d.region_code)})</span>` : ''}`) +
        fila('Ciudad', esc(d.city)) +
        fila('Código postal', esc(d.postal)) +
        fila('Cod. de llamada', d.calling_code ? `+${esc(d.calling_code)}` : 'N/A') +
        fila('Miembro UE', euBadge) +
        fila('Coordenadas', `${esc(d.latitude)}, ${esc(d.longitude)}` + copyBtnHtml(`${d.latitude},${d.longitude}`));
}

function renderRed(d) {
    const asn = d.asn || {};
    const tipoMap = {
        isp:      `<span class="badge b-ok">ISP</span>`,
        hosting:  `<span class="badge b-warn">Hosting / DC</span>`,
        business: `<span class="badge b-dim">Empresa</span>`,
        edu:      `<span class="badge b-dim">Educación</span>`,
        gov:      `<span class="badge b-dim">Gobierno</span>`,
        mil:      `<span class="badge b-warn">Militar</span>`,
        cdn:      `<span class="badge b-dim">CDN</span>`,
    };
    const tipoBadge = tipoMap[asn.type] || `<span class="badge b-dim">${esc(asn.type) || 'N/A'}</span>`;

    document.getElementById('secRed').innerHTML =
        fila('ASN', esc(asn.asn) + copyBtnHtml(asn.asn), 'accent') +
        fila('Organización', esc(asn.name) + copyBtnHtml(asn.name)) +
        fila('Dominio', asn.domain
            ? `<a href="https://${esc(asn.domain)}" target="_blank" style="color:var(--accent2);text-decoration:none;">${esc(asn.domain)}</a>` + copyBtnHtml(asn.domain)
            : 'N/A') +
        fila('Ruta / Prefijo', esc(asn.route) + copyBtnHtml(asn.route)) +
        fila('Tipo de red', tipoBadge);
}

function renderHorario(d) {
    const tz  = d.time_zone || {};
    const dst = tz.is_dst
        ? `<span class="badge b-warn">Horario de verano activo</span>`
        : `<span class="badge b-dim">Sin horario de verano</span>`;

    let horaActual = 'N/A';
    if (tz.current_time) {
        horaActual = getCorrectLocalTime(tz.current_time, tz.name);
    }

    document.getElementById('secHorario').innerHTML =
        fila('Zona', esc(tz.name)) +
        fila('Abreviación', esc(tz.abbr)) +
        fila('Offset UTC', esc(tz.offset)) +
        fila('Hora actual', horaActual, 'accent') +
        fila('Horario de verano', dst);
}

function renderMoneda(d) {
    const c = d.currency || {};
    document.getElementById('secMoneda').innerHTML =
        fila('Moneda', esc(c.name)) +
        fila('Plural', esc(c.plural)) +
        fila('Código ISO', esc(c.code), 'accent') +
        fila('Símbolo', esc(c.symbol)) +
        fila('Símbolo nativo', esc(c.native));
}

function renderAmenazas(d) {
    const t = d.threat || {};
    const checks = [
        { label: 'TOR',          val: t.is_tor,            dangerMsg: 'Nodo TOR detectado',   okMsg: 'No es TOR' },
        { label: 'Proxy',        val: t.is_proxy,          dangerMsg: 'Proxy detectado',       okMsg: 'No es proxy' },
        { label: 'VPN',          val: t.is_vpn,            dangerMsg: 'VPN detectada',         okMsg: 'Sin VPN' },
        { label: 'Datacenter',   val: t.is_datacenter,     dangerMsg: 'IP de datacenter',      okMsg: 'No datacenter', warnOnTrue: true },
        { label: 'iCloud Relay', val: t.is_icloud_relay,   dangerMsg: 'iCloud Private Relay',  okMsg: 'Sin iCloud Relay' },
        { label: 'Anónimo',      val: t.is_anonymous,      dangerMsg: 'Tráfico anónimo',       okMsg: 'No anónimo' },
        { label: 'Atacante',     val: t.is_known_attacker, dangerMsg: 'Fuente de ataques',     okMsg: 'Sin alertas' },
        { label: 'Abusador',     val: t.is_known_abuser,   dangerMsg: 'Fuente de spam/bots',   okMsg: 'Sin alertas' },
        { label: 'Amenaza',      val: t.is_threat,         dangerMsg: 'Amenaza confirmada',    okMsg: 'Sin amenaza' },
        { label: 'IP Bogon',     val: t.is_bogon,          dangerMsg: 'IP bogon (inválida)',    okMsg: 'IP válida' },
    ];

    const items = checks.map(c => {
        let cls, dotCls, msg;
        if (c.val === true) {
            cls = c.warnOnTrue ? 'warn' : 'danger';
            dotCls = c.warnOnTrue ? 'warn' : 'danger';
            msg = c.dangerMsg;
        } else if (c.val === false) {
            cls = 'ok'; dotCls = 'ok'; msg = c.okMsg;
        } else {
            cls = 'warn'; dotCls = 'warn'; msg = 'Sin datos';
        }
        return `<div class="threat-item">
            <div class="threat-dot ${dotCls}"></div>
            <div class="threat-info">
                <div class="threat-name">${c.label}</div>
                <div class="threat-status ${cls}">${msg}</div>
            </div>
        </div>`;
    }).join('');

    document.getElementById('secAmenazas').innerHTML = `<div class="threat-grid">${items}</div>`;
}

function renderMapa(d) {
    const lat = d.latitude;
    const lng = d.longitude;
    if (!lat || !lng) {
        document.getElementById('secMapa').innerHTML = '<p style="padding:20px;color:var(--text-dim)">Coordenadas no disponibles.</p>';
        return;
    }
    document.getElementById('secMapa').innerHTML = `
        <div class="map-wrap">
            <iframe src="https://maps.google.com/maps?q=${lat},${lng}&z=12&output=embed" loading="lazy" title="Mapa de ubicación"></iframe>
            <div class="map-coords"><span>Lat: ${lat}</span><span>Lng: ${lng}</span></div>
        </div>`;
}

/* ══════════════════════════════════════════════════
   BLACKLIST
══════════════════════════════════════════════════ */
function verificarBlacklist() {
    const btn     = document.getElementById('btnBlacklist');
    const sec     = document.getElementById('secBlacklist');
    const summary = document.getElementById('blSummary');

    if (!_currentIP) return;

    btn.disabled = true;
    btn.textContent = 'Verificando...';
    summary.classList.add('hidden');
    sec.innerHTML = `<div id="loading" class="loading">
            <div class="skeleton title"></div>
            <div class="skeleton text"></div>
            <div class="skeleton text"></div>
            <div class="skeleton text short"></div>
            <div style="margin-top:20px;width:100%">
                <div class="skeleton title" style="width:20%"></div>
                <div class="skeleton text"></div>
                <div class="skeleton text short"></div>
            </div>
        </div>`;

    apiFetch(`api/blacklist.php?ip=${encodeURIComponent(_currentIP)}`)
        .then(data => {
            btn.textContent = 'Re-verificar';
            btn.disabled = false;

            if (data.private) {
                sec.innerHTML = `<p style="padding:18px 20px;color:var(--text-dim);font-size:13px;">⚠ ${esc(data.note)}</p>`;
                return;
            }

            const clean = data.clean;
            summary.innerHTML = clean
                ? `<span class="badge b-ok">✓ Limpia en ${data.total} listas</span>`
                : `<span class="badge b-danger">✗ En ${data.listed}/${data.total} listas</span>`;
            summary.classList.remove('hidden');

            const items = data.dnsbl.map(r => {
                const cls    = r.skipped ? 'warn' : r.error ? 'warn' : (r.listed ? 'danger' : 'ok');
                const dotCls = r.skipped ? 'warn' : r.error ? 'warn' : (r.listed ? 'danger' : 'ok');
                const msg    = r.skipped ? 'Sin key' : r.error ? 'Sin respuesta' : (r.listed ? `LISTADA${r.code ? ` (${r.code})` : ''}` : 'Limpia');
                const catIcon = { spam:'📧', botnet:'🤖', enterprise:'🏢', spamhaus:'🔰', dynamic:'📡', spamrats:'🐀', backscatter:'↩', bogon:'🚧' }[r.category] || '🔍';
                return `<div class="bl-item">
                    <div class="threat-dot ${dotCls}"></div>
                    <div class="threat-info" style="flex:1;min-width:0">
                        <div class="threat-name">${catIcon} ${esc(r.name)}</div>
                        <div class="threat-status ${cls}">${msg}</div>
                    </div>
                    <a href="${esc(r.url)}" target="_blank" class="bl-link">↗</a>
                </div>`;
            }).join('');

            let abuseHtml = '';
            if (data.abuseipdb) {
                const a = data.abuseipdb;
                const scoreColor = a.score > 50 ? 'var(--danger)' : a.score > 20 ? 'var(--warn)' : 'var(--ok)';
                abuseHtml = `<div class="bl-ext">
                    <div class="bl-ext-h">AbuseIPDB</div>
                    <div class="bl-ext-row"><span>Score de abuso</span><span style="font-family:var(--mono);color:${scoreColor};font-weight:500">${a.score}%</span></div>
                    <div class="bl-ext-row"><span>Reportes totales</span><span style="font-family:var(--mono)">${a.totalReports}</span></div>
                    <div class="bl-ext-row"><span>Último reporte</span><span style="font-family:var(--mono)">${a.lastReportedAt ? a.lastReportedAt.split('T')[0] : 'Sin reportes'}</span></div>
                </div>`;
            } else {
                abuseHtml = `<div class="bl-ext">
                    <div class="bl-ext-h">AbuseIPDB</div>
                    <p class="bl-ext-note">Configurá <code>ABUSEIPDB_KEY</code> (o en FacuTools: Configuración → Integraciones).<br>
                    API gratuita: <a href="https://www.abuseipdb.com/register" target="_blank" style="color:var(--accent2)">abuseipdb.com/register</a></p>
                </div>`;
            }

            const keys = data.keys || {};
            const keyBadge = (ok, label) => `<span class="badge ${ok ? 'b-ok' : 'b-warn'}">${label}: ${ok ? 'OK' : 'faltante'}</span>`;
            const keysHtml = `<div class="bl-ext">
                <div class="bl-ext-h">API keys (blacklists / IPScope)</div>
                <p class="bl-ext-note" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
                    ${keyBadge(!!keys.abuseipdb, 'AbuseIPDB')}
                    ${keyBadge(!!keys.spamrats, 'SpamRATS')}
                    ${keyBadge(!!keys.spamhaus_dqs, 'Spamhaus DQS')}
                </p>
            </div>`;

            const fortiHtml = `<div class="bl-ext">
                <div class="bl-ext-h">FortiGuard IP Reputation</div>
                <p class="bl-ext-note">FortiGuard usa una base de datos privada (IRDB). Consultala en su portal oficial:</p>
                <a href="${esc(data.fortiguard)}" target="_blank" class="btn-fortiguard">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    Consultar en FortiGuard Labs ↗
                </a>
            </div>`;

            sec.innerHTML = `<div class="bl-grid">${items}</div>${abuseHtml}${keysHtml}${fortiHtml}`;
            initCopyCards();
        })
        .catch(err => {
            btn.disabled = false;
            btn.textContent = 'Verificar';
            sec.innerHTML = `<p style="padding:16px 20px;color:var(--danger);font-family:var(--mono);font-size:13px;">Error: ${esc(err.message)}</p>`;
        });
}

/* ══════════════════════════════════════════════════
   DNS CHECKER
══════════════════════════════════════════════════ */
function buscarDNS() {
    const domain = document.getElementById('dnsInput').value.trim();
    if (!domain) return;
    saveHistory('dns', domain);
    cargarDNS(domain);
}

function cargarDNS(domain) {
    const els = { res: 'dns-resultado', err: 'dns-error', load: 'dns-loading' };
    toggleLoadingState(els, true);

    apiFetch(`api/dns.php?domain=${encodeURIComponent(domain)}`)
        .then(data => {
            renderDNS(data);
            toggleLoadingState(els, false, true);
        })
        .catch(err => toggleLoadingState(els, false, false, err.message));
}

/* ── DNS Render ───────────────────────────────── */
function renderDNS(d) {
    document.getElementById('dnsHeroDomain').textContent = d.domain;
    document.getElementById('dnsHeroIP').textContent = d.server_ip
        ? `IP del servidor: ${d.server_ip}`
        : 'IP no resuelta';
    const types = Object.keys(d.records);
    document.getElementById('dnsHeroTypes').innerHTML =
        `<div class="time-val">${types.length}</div><div class="time-label">tipos de registros</div>`;

    // Agregar botón rápido a DOMSCAN.net en la interfaz DNS
    const actionsContainer = document.getElementById('dnsHeroActions') || document.getElementById('dnsHeroTypes');
    if (actionsContainer) {
        const domscanLink = `<a href="https://domscan.net/scan?target=${encodeURIComponent(d.domain)}" target="_blank" class="badge b-warn" style="text-decoration:none; margin-top:10px; display:inline-block;">Escanear en DOMSCAN ↗</a>`;
        actionsContainer.insertAdjacentHTML('beforeend', domscanLink);
    }

    renderEmailSecurity(d.email_security);
    renderProviders(d.providers);
    renderNS(d.ns);
    renderDNSRecords(d.records);
    initCopyCards();
}

function renderEmailSecurity(es) {
    const checks = [
        { label: 'SPF',   ok: es.spf,         okMsg: 'Configurado',    failMsg: 'No encontrado' },
        { label: 'DMARC', ok: es.dmarc,        okMsg: 'Configurado',    failMsg: 'No encontrado' },
        { label: 'DKIM',  ok: es.dkim.length > 0, okMsg: es.dkim.join(', ') || 'Encontrado', failMsg: 'No encontrado' },
    ];

    document.getElementById('dns-secEmail').innerHTML =
        `<div class="threat-grid" style="grid-template-columns:repeat(3,1fr)">` +
        checks.map(c => `
        <div class="threat-item">
            <div class="threat-dot ${c.ok ? 'ok' : 'danger'}"></div>
            <div class="threat-info">
                <div class="threat-name">${c.label}</div>
                <div class="threat-status ${c.ok ? 'ok' : 'danger'}">${c.ok ? c.okMsg : c.failMsg}</div>
            </div>
        </div>`).join('') +
        `</div>`;
}

function renderProviders(providers) {
    const el = document.getElementById('dns-secProviders');
    if (!providers.length) {
        el.innerHTML = '<p class="dns-empty">No se detectaron proveedores conocidos.</p>';
        return;
    }
    const typeLabel = { cdn: 'CDN', dns: 'DNS', email: 'Email', registrar: 'Registrar' };
    const typeBadge = { cdn: 'b-ok', dns: 'b-dim', email: 'b-ok', registrar: 'b-dim' };
    el.innerHTML = `<div class="providers-grid">` +
        providers.map(p => `
        <div class="provider-item">
            <div class="provider-name">${esc(p.name)}</div>
            <span class="badge ${typeBadge[p.type] || 'b-dim'}">${typeLabel[p.type] || p.type}</span>
        </div>`).join('') +
        `</div>`;
}

function renderNS(ns) {
    const el = document.getElementById('dns-secNS');
    if (!ns.length) {
        el.innerHTML = '<p class="dns-empty">No se encontraron nameservers.</p>';
        return;
    }
    el.innerHTML = ns.map(n =>
        `<div class="data-row"><span class="data-label">NS</span><span class="data-val accent">${esc(n)} ${copyBtnHtml(n)}</span></div>`
    ).join('');
}

const TYPE_META = {
    A:     { icon: '🌐', label: 'A — IPv4',       wide: false },
    AAAA:  { icon: '🌐', label: 'AAAA — IPv6',     wide: false },
    MX:    { icon: '✉',  label: 'MX — Mail',       wide: true  },
    TXT:   { icon: '📄', label: 'TXT — Texto',     wide: true  },
    CNAME: { icon: '↩',  label: 'CNAME — Alias',   wide: false },
    SOA:   { icon: '📋', label: 'SOA — Autoridad', wide: true  },
    CAA:   { icon: '🔒', label: 'CAA — Cert Auth', wide: false },
    SRV:   { icon: '⚙',  label: 'SRV — Servicio',  wide: true  },
    PTR:   { icon: '↔',  label: 'PTR — Inverso',   wide: false },
};

function renderDNSRecords(records) {
    const grid  = document.getElementById('dns-records-grid');
    const types = Object.keys(records);
    if (!types.length) { grid.innerHTML = ''; return; }

    grid.innerHTML = types.map(type => {
        const meta = TYPE_META[type] || { icon: '📌', label: type, wide: false };
        const recs = records[type];
        const wide = (meta.wide || recs.length > 3) ? 'card-wide' : '';
        return `<div class="card ${wide}">
            <div class="card-header">
                <span class="card-icon">${meta.icon}</span>
                <h2>${meta.label}</h2>
                <span class="dns-count">${recs.length}</span>
            </div>
            <div class="card-body">${recs.map(r => dnsRow(type, r)).join('')}</div>
        </div>`;
    }).join('');
}

function dnsRow(type, r) {
    switch (type) {
        case 'MX':
            return `<div class="data-row">
                <span class="data-label">Prioridad ${esc(r.priority)}</span>
                <span class="data-val">${esc(r.value)} <span class="dns-ttl">TTL ${esc(r.ttl)}</span></span>
            </div>`;
        case 'TXT':
            return `<div class="dns-txt-row">
                <span class="dns-txt-val">${esc(r.value)}</span>
                <span class="dns-ttl">TTL ${esc(r.ttl)}</span>
            </div>`;
        case 'SOA':
            return `
                ${fila('Primario',   `<span class="accent">${esc(r.mname)}</span>`)}
                ${fila('Email admin', esc(r.rname))}
                ${fila('Serial',      esc(r.serial))}
                ${fila('Refresh',     esc(r.refresh) + 's')}
                ${fila('Retry',       esc(r.retry) + 's')}
                ${fila('Expire',      esc(r.expire) + 's')}
                ${fila('TTL mínimo',  esc(r.minimum) + 's')}`;
        case 'SRV':
            return `<div class="data-row">
                <span class="data-label">Pri ${esc(r.priority)} / W ${esc(r.weight)}</span>
                <span class="data-val">${esc(r.value)}:${esc(r.port)} <span class="dns-ttl">TTL ${esc(r.ttl)}</span></span>
            </div>`;
        case 'CAA':
            return `<div class="data-row">
                <span class="data-label">${esc(r.tag)}</span>
                <span class="data-val">${esc(r.value)} <span class="dns-ttl">TTL ${esc(r.ttl)}</span></span>
            </div>`;
        default:
            return `<div class="data-row">
                <span class="data-label">Valor</span>
                <span class="data-val accent">${esc(r.value)} ${copyBtnHtml(r.value)} <span class="dns-ttl">TTL ${esc(r.ttl)}</span></span>
            </div>`;
    }
}

/* ══════════════════════════════════════════════════
   WHOIS / RDAP
══════════════════════════════════════════════════ */
function buscarWhois() {
    const domain = document.getElementById('whoisInput').value.trim();
    if (!domain) return;
    saveHistory('whois', domain);
    cargarWhois(domain);
}

function cargarWhois(domain) {
    const els = { res: 'whois-resultado', err: 'whois-error', load: 'whois-loading' };
    toggleLoadingState(els, true);

    apiFetch(`api/whois.php?domain=${encodeURIComponent(domain)}`)
        .then(data => {
            renderWhois(data);
            toggleLoadingState(els, false, true);
        })
        .catch(err => toggleLoadingState(els, false, false, err.message));
}

/* ── Render principal WHOIS ───────────────────── */
function renderWhois(d) {
    renderWhoisHero(d);
    renderWhoisStatus(d);
    renderWhoisDates(d);
    renderWhoisRegistrar(d);
    renderWhoisRegistrant(d);
    renderWhoisNS(d);
    renderWhoisSecurity(d);
    initCopyCards();
}

function renderWhoisHero(d) {
    const badge = d.is_ar
        ? `<span class="badge b-ok" style="font-size:11px">NIC Argentina (.ar)</span>`
        : `<span class="badge b-dim" style="font-size:11px">RDAP Internacional</span>`;

    document.getElementById('whoisHeroDomain').innerHTML = esc(d.ldhName || d.domain) + ' ' + badge;
    document.getElementById('whoisHeroSource').textContent = d.source;

    const expEl = document.getElementById('whoisHeroExpiry');
    const days  = d.days_expiry;
    if (days !== null && days !== undefined) {
        const cls  = days < 0 ? 'danger' : days < 30 ? 'warn' : 'ok';
        const txt  = days < 0
            ? `Vencido hace ${Math.abs(days)} días`
            : days === 0
                ? 'Vence hoy'
                : `Vence en ${days} días`;
        expEl.innerHTML = `
            <div class="time-val" style="color:var(--${cls === 'ok' ? 'ok' : cls === 'warn' ? 'warn' : 'danger'})">${days < 0 ? '!' : days}</div>
            <div class="time-label">${txt}</div>`;
    } else {
        expEl.innerHTML = '';
    }
}

function renderWhoisStatus(d) {
    const el = document.getElementById('whois-secStatus');
    if (!d.status || !d.status.length) {
        el.innerHTML = '<p class="dns-empty">Sin información de estado.</p>';
        return;
    }
    el.innerHTML = `<div class="threat-grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">` +
        d.status.map(s => `
        <div class="threat-item">
            <div class="threat-dot ${s.type === 'ok' ? 'ok' : s.type === 'warn' ? 'warn' : 'danger'}"></div>
            <div class="threat-info">
                <div class="threat-name">${esc(s.raw)}</div>
                <div class="threat-status ${s.type === 'ok' ? 'ok' : s.type === 'warn' ? 'warn' : 'danger'}">${esc(s.label)}</div>
            </div>
        </div>`).join('') +
        `</div>`;
}

function renderWhoisDates(d) {
    const ev = d.events || {};
    const dateMap = {
        'registration':  'Registro',
        'expiration':    'Vencimiento',
        'last changed':  'Última modificación',
        'transfer':      'Última transferencia',
        'deletion':      'Eliminación',
    };
    const el = document.getElementById('whois-secDates');
    const rows = Object.entries(dateMap)
        .filter(([k]) => ev[k])
        .map(([k, label]) => {
            const isExpiry = k === 'expiration';
            const days = isExpiry ? d.days_expiry : null;
            let extra = '';
            if (days !== null && days !== undefined) {
                const cls = days < 0 ? 'var(--danger)' : days < 30 ? 'var(--warn)' : 'var(--ok)';
                extra = ` <span style="color:${cls};font-size:11px">(${days < 0 ? 'vencido' : days + 'd restantes'})</span>`;
            }
            return fila(label, esc(ev[k]) + extra);
        });

    el.innerHTML = rows.length ? rows.join('') : '<p class="dns-empty">Sin fechas disponibles.</p>';
}

function renderWhoisEntity(elId, entity, fallbackMsg) {
    const el = document.getElementById(elId);
    if (!entity || !Object.keys(entity).length) {
        el.innerHTML = `<p class="dns-empty">${fallbackMsg}</p>`;
        return;
    }
    const fields = [
        ['Nombre',      entity.name],
        ['Organización',entity.org],
        ['Handle',      entity.handle],
        ['IANA ID',     entity.iana_id],
        ['Email',       entity.email],
        ['Teléfono',    entity.tel],
        ['Dirección',   entity.address],
    ];
    el.innerHTML = fields
        .filter(([, v]) => v)
        .map(([k, v]) => fila(k, esc(v)))
        .join('') || `<p class="dns-empty">${fallbackMsg}</p>`;
}

function renderWhoisRegistrar(d)   { renderWhoisEntity('whois-secRegistrar',   d.entities?.registrar,   'Sin datos de registrar disponibles.'); }
function renderWhoisRegistrant(d)  { renderWhoisEntity('whois-secRegistrant',  d.entities?.registrant,  'Sin datos del titular (posiblemente ocultados por GDPR/privacidad).'); }

function renderWhoisNS(d) {
    const el = document.getElementById('whois-secNS');
    if (!d.nameservers || !d.nameservers.length) {
        el.innerHTML = '<p class="dns-empty">Sin nameservers registrados.</p>';
        return;
    }
    el.innerHTML = d.nameservers.map(ns =>
        fila('NS', `<span class="accent">${esc(ns)}</span> ${copyBtnHtml(ns)}`)
    ).join('');
}

function renderWhoisSecurity(d) {
    const el = document.getElementById('whois-secSecurity');
    el.innerHTML = `<div class="threat-grid" style="grid-template-columns:repeat(2,1fr)">
        <div class="threat-item">
            <div class="threat-dot ${d.dnssec ? 'ok' : 'warn'}"></div>
            <div class="threat-info">
                <div class="threat-name">DNSSEC</div>
                <div class="threat-status ${d.dnssec ? 'ok' : 'warn'}">${d.dnssec ? 'Habilitado' : 'No habilitado'}</div>
            </div>
        </div>
        <div class="threat-item">
            <div class="threat-dot ok"></div>
            <div class="threat-info">
                <div class="threat-name">Fuente</div>
                <div class="threat-status ok">${esc(d.source)}</div>
            </div>
        </div>
    </div>
    <div style="padding:10px 20px 14px">
        <a href="${esc(d.rdap_url)}" target="_blank" style="font-family:var(--mono);font-size:11px;color:var(--accent2);text-decoration:none;">
            Ver respuesta RDAP completa ↗
        </a>
    </div>`;
}

/* ══════════════════════════════════════════════════
   PROPAGACIÓN DNS
══════════════════════════════════════════════════ */
function buscarProp() {
    const domain = document.getElementById('propInput').value.trim();
    if (!domain) return;
    const type = document.getElementById('propType').value;
    saveHistory('prop', domain);
    cargarProp(domain, type);
}

function cargarProp(domain, type) {
    const els = { res: 'prop-resultado', err: 'prop-error', load: 'prop-loading' };
    document.getElementById('prop-loading-txt').textContent = `Consultando 21 servidores DNS globales para ${type} de ${domain}...`;
    toggleLoadingState(els, true);

    apiFetch(`api/propagation.php?domain=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`)
        .then(data => {
            renderProp(data);
            toggleLoadingState(els, false, true);
        })
        .catch(err => toggleLoadingState(els, false, false, err.message));
}

function renderProp(d) {
    // Hero
    const pct = d.pct;
    const barCls = pct === 100 ? '' : pct > 50 ? 'partial' : 'none';
    document.getElementById('propHeroDomain').textContent = d.domain;
    document.getElementById('propHeroInfo').innerHTML =
        `Registro <span style="font-family:var(--mono);color:var(--accent)">${esc(d.type)}</span> &nbsp;·&nbsp; ${d.total_ms}ms total` +
        `<div class="prop-bar-wrap"><div class="prop-bar ${barCls}" style="width:${pct}%"></div></div>` +
        `<div class="prop-summary-detail">${d.propagated} de ${d.total} servidores respondieron correctamente</div>`;

    const statColor = pct === 100 ? 'var(--ok)' : pct > 50 ? 'var(--warn)' : 'var(--danger)';
    document.getElementById('propHeroStats').innerHTML =
        `<div class="time-val" style="color:${statColor}">${pct}%</div>` +
        `<div class="time-label">propagado</div>`;

    document.getElementById('propCount').textContent = `${d.propagated}/${d.total}`;

    // Advertencia de inconsistencia
    let inconsistentHtml = '';
    if (!d.consistent && d.propagated > 1) {
        inconsistentHtml = `<div class="prop-inconsistent-warn">
            ⚠ Los servidores devuelven valores distintos — la propagación está en progreso o hay configuraciones inconsistentes.
        </div>`;
    }

    // Tabla
    const rows = d.results.map(r => {
        const msCls = r.ms < 100 ? 'fast' : r.ms < 400 ? 'medium' : 'slow';
        const valDisplay = r.error
            ? 'Timeout / sin respuesta'
            : r.raw === 'NXDOMAIN' ? 'NXDOMAIN — dominio no encontrado'
            : r.raw === 'NODATA'   ? 'Sin registros de este tipo'
            : esc(r.values.join(' · ')) || 'Sin datos';

        return `<tr>
            <td style="width:8px;padding-left:16px"><span class="prop-dot ${r.status}"></span></td>
            <td>
                <div class="prop-server-name">${r.flag} ${esc(r.server)}</div>
                <div class="prop-location">${esc(r.ip)} &nbsp;·&nbsp; ${esc(r.location)}</div>
            </td>
            <td><span class="prop-value ${r.status}">${valDisplay}</span></td>
            <td><span class="prop-ms ${msCls}">${r.error ? '—' : r.ms + 'ms'}</span></td>
        </tr>`;
    }).join('');

    document.getElementById('prop-secResults').innerHTML = inconsistentHtml + `
        <table class="prop-table">
            <thead>
                <tr>
                    <th></th>
                    <th>Servidor</th>
                    <th>Respuesta</th>
                    <th>Latencia</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
    initCopyCards();
}

/* ══════════════════════════════════════════════════
   SEARCH HISTORY
══════════════════════════════════════════════════ */
function getHistory(tab) {
    try {
        const stored = localStorage.getItem('ipscope_history_' + tab);
        return stored ? JSON.parse(stored) : [];
    } catch(e) { return []; }
}

function saveHistory(tab, val) {
    let hist = getHistory(tab);
    hist = hist.filter(h => h.toLowerCase() !== val.toLowerCase());
    hist.unshift(val);
    if (hist.length > 10) hist.pop();
    try { localStorage.setItem('ipscope_history_' + tab, JSON.stringify(hist)); } catch(e) {}
    renderHistory(tab);
}

function clearHistory(tab) {
    try { localStorage.removeItem('ipscope_history_' + tab); } catch(e) {}
    renderHistory(tab);
}

function removeFromHistory(tab, val) {
    let hist = getHistory(tab);
    hist = hist.filter(h => h !== val);
    try { localStorage.setItem('ipscope_history_' + tab, JSON.stringify(hist)); } catch(e) {}
    renderHistory(tab);
}

function renderHistory(tab) {
    const container = document.getElementById('history-' + tab);
    if (!container) return;
    const hist = getHistory(tab);
    if (hist.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }
    
    let html = `<div class="history-header">
        <span>Búsquedas recientes</span>
        <button class="history-clear-all" onmousedown="clearHistory('${tab}')">Borrar todo</button>
    </div>`;
    
    hist.forEach(h => {
        const safeH = String(h).replace(/'/g, "\\'").replace(/"/g, "&quot;");
        html += `<div class="history-item" tabindex="0" onmousedown="fillHistory('${tab}', '${safeH}')" onkeydown="if(event.key==='Enter') fillHistory('${tab}', '${safeH}')">
            <span class="history-text">${esc(h)}</span>
            <button class="history-remove" aria-label="Eliminar" onmousedown="event.stopPropagation(); removeFromHistory('${tab}', '${safeH}')">✕</button>
        </div>`;
    });
    
    container.innerHTML = html;
}

function fillHistory(tab, val) {
    const input = document.getElementById(tab + 'Input');
    if (input) {
        input.value = val;
        // Trigger search
        if (tab === 'ip') buscarIP();
        if (tab === 'dns') buscarDNS();
        if (tab === 'whois') buscarWhois();
        if (tab === 'prop') buscarProp();
        if (tab === 'ransom') filtrarRansomware();
    }
}

/* ══════════════════════════════════════════════════
   COPY CARD LOGIC
══════════════════════════════════════════════════ */
function copyCard(btn) {
    const card = btn.closest('.card');
    if (!card) return;
    const titleEl = card.querySelector('h2');
    const title = titleEl ? titleEl.innerText : 'Datos';
    let textToCopy = `=== ${title} ===\n`;
    
    const body = card.querySelector('.card-body');
    if (!body) return;
    
    const rows = body.querySelectorAll('.data-row');
    const threats = body.querySelectorAll('.threat-item');
    const props = body.querySelectorAll('.prop-table tbody tr');
    const blItems = body.querySelectorAll('.bl-item');
    const providers = body.querySelectorAll('.provider-item');
    
    if (rows.length > 0) {
        rows.forEach(r => {
            const label = r.querySelector('.data-label').innerText;
            const clone = r.querySelector('.data-val').cloneNode(true);
            clone.querySelectorAll('.btn-copy').forEach(b => b.remove());
            textToCopy += `${label}: ${clone.innerText.trim()}\n`;
        });
    } else if (threats.length > 0) {
        threats.forEach(t => {
            const name = t.querySelector('.threat-name').innerText;
            const status = t.querySelector('.threat-status').innerText;
            textToCopy += `${name}: ${status}\n`;
        });
    } else if (props.length > 0) {
        props.forEach(r => {
            const server = r.querySelector('.prop-server-name').innerText;
            const ipLoc = r.querySelector('.prop-location').innerText;
            const val = r.querySelector('.prop-value').innerText;
            const ms = r.querySelector('.prop-ms').innerText;
            textToCopy += `[${server} | ${ipLoc}] -> ${val} (${ms})\n`;
        });
    } else if (blItems.length > 0) {
        const summary = card.querySelector('.bl-summary');
        if (summary && !summary.classList.contains('hidden')) textToCopy += `Resultado: ${summary.innerText}\n\n`;
        blItems.forEach(i => {
            const name = i.querySelector('.threat-name').innerText;
            const status = i.querySelector('.threat-status').innerText;
            textToCopy += `${name}: ${status}\n`;
        });
    } else if (providers.length > 0) {
        providers.forEach(p => {
            const name = p.querySelector('.provider-name').innerText;
            const badge = p.querySelector('.badge').innerText;
            textToCopy += `${name} (${badge})\n`;
        });
    } else {
        const clone = body.cloneNode(true);
        clone.querySelectorAll('.btn-copy, svg').forEach(b => b.remove());
        textToCopy += clone.innerText.trim();
    }

    navigator.clipboard.writeText(textToCopy.trim()).then(() => {
        showToast(`Tarjeta '${title}' copiada`);
        const oldHtml = btn.innerHTML;
        btn.innerHTML = '✓';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = oldHtml;
            btn.classList.remove('copied');
        }, 2000);
    }).catch(err => showToast('Error al copiar tarjeta', 'error'));
}

function initCopyCards() {
    document.querySelectorAll('.card-header').forEach(header => {
        if (!header.querySelector('.btn-copy-card')) {
            let actions = header.querySelector('.card-header-actions');
            if (!actions) {
                actions = document.createElement('div');
                actions.className = 'card-header-actions';
                header.appendChild(actions);
            }
            actions.insertAdjacentHTML('beforeend', `<button class="btn-copy btn-copy-card" onclick="copyCard(this)" aria-label="Copiar Tarjeta" title="Copiar tarjeta completa" style="margin-left:auto"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`);
        }
    });
}

/* ══════════════════════════════════════════════════
   RANSOMWARE LOGIC
══════════════════════════════════════════════════ */
let ransomwareData = [];
let currentRansomwareMethod = 'recentvictims';

function actualizarCamposRansomware() {
    const method = document.getElementById('ransomMethod').value;
    const w1 = document.getElementById('ransomParam1Wrap');
    const p1 = document.getElementById('ransomParam1');
    
    w1.style.display = 'none';
    p1.value = '';
    
    switch(method) {
        case 'group':
        case 'iocs':
        case 'ransomnotes':
        case 'yara':
            w1.style.display = 'block';
            p1.placeholder = 'Nombre del grupo (ej: lockbit3)';
            break;
        case 'victims/search':
            w1.style.display = 'block';
            p1.placeholder = 'Palabra clave (ej: hospital)';
            break;
        case 'csirt':
            w1.style.display = 'block';
            p1.placeholder = 'Código de país ISO2 (ej: AR, US)';
            break;
    }
}

function cargarRansomware(force = false) {
    const method = document.getElementById('ransomMethod').value;
    const p1 = document.getElementById('ransomParam1').value.trim();
    
    if ((method === 'group' || method === 'victims/search' || method === 'csirt' || method === 'yara' || method === 'iocs' || method === 'ransomnotes') && !p1) {
        showToast('Por favor completa el campo requerido', 'warning');
        return;
    }
    
    document.getElementById('ransom-resultado').classList.add('hidden');
    document.getElementById('ransom-error').classList.add('hidden');
    document.getElementById('ransom-loading').classList.remove('hidden');

    let endpoint = method;
    let url = 'api/ransomware.php?';
    
    if (method === 'victims/search') {
        url += `endpoint=${encodeURIComponent(endpoint)}&q=${encodeURIComponent(p1)}`;
    } else if (method === 'group' || method === 'csirt' || method === 'yara' || method === 'iocs' || method === 'ransomnotes') {
        endpoint += `/${encodeURIComponent(p1)}`;
        url += `endpoint=${encodeURIComponent(endpoint)}`;
    } else {
        url += `endpoint=${encodeURIComponent(endpoint)}`;
    }

    apiFetch(url).then(data => {
            if (data && !Array.isArray(data)) {
                if (Array.isArray(data.victims)) data = data.victims;
                else if (Array.isArray(data.groups)) data = data.groups;
                else if (Array.isArray(data.csirt)) data = data.csirt;
                else if (Array.isArray(data.iocs)) data = data.iocs;
                else if (Array.isArray(data.yara)) data = data.yara;
                else if (Array.isArray(data.rules)) data = data.rules;
                else if (Array.isArray(data.notes)) data = data.notes;
                else if (Array.isArray(data.ransomnotes)) data = data.ransomnotes;
                else if (Array.isArray(data.press)) data = data.press;
                else if (Array.isArray(data.results)) data = data.results;
                else if (Array.isArray(data.data)) data = data.data;
            }
            
            ransomwareData = data;
            currentRansomwareMethod = method;
            renderRansomware(ransomwareData);
            
            toggleLoadingState(els, false, true);
    }).catch(err => {
        toggleLoadingState(els, false, false, err.message);
    });
}

/* ══════════════════════════════════════════════════
   PASSWORD GENERATOR
══════════════════════════════════════════════════ */
function generatePassword() {
    const lenEl = document.getElementById('passLength');
    const len = lenEl ? (parseInt(lenEl.value) || 16) : 16;
    const useUpper = document.getElementById('passUpper') ? document.getElementById('passUpper').checked : true;
    const useLower = document.getElementById('passLower') ? document.getElementById('passLower').checked : true;
    const useNum = document.getElementById('passNum') ? document.getElementById('passNum').checked : true;
    const useSym = document.getElementById('passSym') ? document.getElementById('passSym').checked : true;
    
    const chars = {
        upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        lower: 'abcdefghijklmnopqrstuvwxyz',
        num: '0123456789',
        sym: '!@#$%^&*()_+~`|}{[]:;?><,./-='
    };
    
    let allowed = '';
    if (useUpper) allowed += chars.upper;
    if (useLower) allowed += chars.lower;
    if (useNum) allowed += chars.num;
    if (useSym) allowed += chars.sym;
    
    if (!allowed) {
        showToast('Debes seleccionar al menos un tipo de caracter', 'error');
        return;
    }
    
    let pass = '';
    const array = new Uint32Array(len);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < len; i++) {
        pass += allowed[array[i] % allowed.length];
    }
    
    const out = document.getElementById('passResult');
    if(out) out.innerHTML = `<span style="font-family:var(--mono);font-size:1.5rem;word-break:break-all;color:var(--text);">${esc(pass)}</span> ${copyBtnHtml(pass)}`;
    
    // Evaluar fortaleza (Estimación de entropía)
    let entropy = Math.log2(allowed.length) * len;
    const strengthEl = document.getElementById('passStrength');
    if(strengthEl) {
        if (entropy < 40) { strengthEl.textContent = 'Débil'; strengthEl.className = 'threat-status danger'; }
        else if (entropy < 60) { strengthEl.textContent = 'Buena'; strengthEl.className = 'threat-status warn'; }
        else { strengthEl.textContent = 'Fuerte'; strengthEl.className = 'threat-status ok'; }
    }
}

/* ══════════════════════════════════════════════════
   IP CALCULATOR
══════════════════════════════════════════════════ */
function calculateIP() {
    const input = document.getElementById('ipCalcInput');
    if (!input || !input.value.trim()) return;
    
    let val = input.value.trim();
    let [ipStr, cidrStr] = val.split('/');
    if (!cidrStr) cidrStr = '24'; // Predeterminado a /24
    
    const cidr = parseInt(cidrStr, 10);
    if (isNaN(cidr) || cidr < 0 || cidr > 32 || !ipStr.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
        showToast('Formato inválido. Usa IP/CIDR (ej: 192.168.1.10/24)', 'error');
        return;
    }
    
    const ipParts = ipStr.split('.').map(Number);
    if (ipParts.some(p => p < 0 || p > 255)) {
        showToast('Octetos de IP fuera de rango (0-255)', 'error');
        return;
    }
    
    const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const maskInt = ~((1 << (32 - cidr)) - 1);
    const networkInt = ipInt & maskInt;
    const broadcastInt = networkInt | ~maskInt;
    
    const intToIp = (int) => [
        (int >>> 24) & 255,
        (int >>> 16) & 255,
        (int >>> 8) & 255,
        int & 255
    ].join('.');
    
    const numHosts = Math.max(0, Math.pow(2, 32 - cidr) - 2);
    
    const resEl = document.getElementById('ipCalcResult');
    if(resEl) {
        resEl.innerHTML = `
            <div class="card card-wide">
                <div class="card-header"><span class="card-icon">🧮</span><h2>Resultados de Subred: ${esc(val)}</h2></div>
                <div class="card-body">
                    ${fila('IP Original', ipStr)}
                    ${fila('Máscara de subred', intToIp(maskInt) + ' (/' + cidr + ')')}
                    ${fila('Red (Network)', intToIp(networkInt), 'accent')}
                    ${fila('Broadcast', intToIp(broadcastInt))}
                    ${fila('Primer Host', cidr < 31 ? intToIp(networkInt + 1) : 'N/A')}
                    ${fila('Último Host', cidr < 31 ? intToIp(broadcastInt - 1) : 'N/A')}
                    ${fila('Hosts Utilizables', numHosts.toLocaleString())}
                </div>
            </div>
        `;
        resEl.classList.remove('hidden');
        initCopyCards();
    }
}

/* ══════════════════════════════════════════════════
   SMTP TESTER
══════════════════════════════════════════════════ */
function testSMTP() {
    const host = document.getElementById('smtpHost') ? document.getElementById('smtpHost').value.trim() : '';
    if (!host) {
        showToast('El servidor SMTP es obligatorio', 'error');
        return;
    }
    
    const formData = new URLSearchParams();
    ['Host', 'Port', 'User', 'Pass', 'From', 'To', 'Security'].forEach(id => {
        const el = document.getElementById('smtp' + id);
        if (el) formData.append(id.toLowerCase(), el.value.trim());
    });
    
    const resEl = document.getElementById('smtp-resultado');
    const els = { res: 'smtp-resultado', err: null, load: 'smtp-loading' };
    toggleLoadingState(els, true);
    
    apiFetch('api/smtp_test.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
    })
    .then(data => {
        if (resEl && data.log) {
            let html = `<div class="card card-wide"><div class="card-header" style="justify-content:space-between"><div style="display:flex; align-items:center; gap:10px"><span class="card-icon">✉️</span><h2>Log de Transacción SMTP</h2></div><span class="badge ${data.success ? 'b-ok' : 'b-danger'}">${data.success ? 'Éxito' : 'Fallo'}</span></div><div class="card-body" style="background:rgba(0,0,0,0.3); padding:15px; border-radius:8px; font-family:monospace; white-space:pre-wrap; font-size:0.85rem; overflow-x:auto; line-height:1.6;">`;
            data.log.forEach(l => {
                let color = l.type === 'tx' ? 'var(--accent)' : (l.type === 'rx' ? 'var(--ok)' : (l.type === 'error' ? 'var(--danger)' : 'var(--warn)'));
                let icon = l.type === 'tx' ? '→ ' : (l.type === 'rx' ? '← ' : (l.type === 'error' ? '❌ ' : 'ℹ️ '));
                html += `<div style="color:${color}"><span style="color:var(--text-dim);font-size:0.75rem">[${l.time}]</span> ${icon}${esc(l.msg)}</div>`;
            });
            html += `</div></div>`;
            resEl.innerHTML = html;
            toggleLoadingState(els, false, true);
            initCopyCards();
        }
    })
    .catch(err => {
        toggleLoadingState(els, false, false);
        showToast('Error de conexión local: ' + err.message, 'error');
    });
}

function filtrarRansomware() {
    const query = document.getElementById('ransomInput').value.toLowerCase().trim();
    
    let filtered = ransomwareData;
    
    if (query) {
        if (Array.isArray(ransomwareData)) {
            filtered = ransomwareData.filter(d => {
                const str = JSON.stringify(d).toLowerCase();
                return str.includes(query);
            });
        }
    }
    renderRansomware(filtered);
}

function renderRansomware(data) {
    const grid = document.getElementById('ransom-grid');
    
    let count = 0;
    if (Array.isArray(data)) count = data.length;
    else if (data && typeof data === 'object') count = 1;
    document.getElementById('ransom-count').textContent = count;

    // Actualizar título del panel dinámicamente según el método de consulta activo
    const titlesMap = {
        'victims/recent': 'Últimas víctimas detectadas',
        'victims/search': 'Resultados de búsqueda de víctimas',
        'groups': 'Lista de grupos de Ransomware',
        'group': 'Información detallada de grupo',
        'iocs': 'Indicadores de Compromiso (IOCs)',
        'ransomnotes': 'Notas de rescate del grupo',
        'yara': 'Reglas YARA del grupo',
        'press/recent': 'Ciberataques recientes en prensa',
        'csirt': 'Contactos CSIRT por País',
        'stats': 'Estadísticas globales de Ransomware'
    };
    const method = document.getElementById('ransomMethod').value;
    const titleText = titlesMap[method] || 'Resultados de la consulta';
    const titleEl = document.getElementById('ransom-title');
    if (titleEl) {
        titleEl.textContent = titleText;
    }
    
    if (count === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-dim);">No se encontraron resultados.</div>';
        grid.className = 'ransom-grid';
        return;
    }

    grid.className = 'ransom-grid';

    // 1. Objeto simple: Stats o Info de Grupo
    if (!Array.isArray(data)) {
        grid.className = 'grid';
        let content = '';
        
        if (data.description && data.locations) {
            // Group detail
            const locsHtml = Array.isArray(data.locations) ? data.locations.map(l => `
                <div style="margin-bottom:4px">
                    ${l.available ? '🟢' : '🔴'} <a href="${esc(l.slug || l.fqdn)}" target="_blank" style="color:var(--primary); text-decoration:none">${esc(l.fqdn || 'Link')}</a> <span style="font-size:10px; color:var(--text-dim)">(${esc(l.type)})</span>
                </div>
            `).join('') : esc(data.locations);

            const badges = [];
            if (data.has_negotiations) badges.push(`<span class="ransom-badge info-badge">💬 Logs de Chat (${data.negotiation_count})</span>`);
            if (data.has_ransomnote) badges.push(`<span class="ransom-badge press-badge">📜 Notas de Rescate (${data.ransomnotes_count})</span>`);

            let extraDetails = '';
            if (data.vulnerabilities && data.vulnerabilities.length > 0) {
                extraDetails += `<details class="ransom-infostealer-details"><summary>Ver Vulnerabilidades Explotadas (CVEs)</summary><pre>${data.vulnerabilities.join(', ')}</pre></details>`;
            }
            if (data.ttps && data.ttps.length > 0) {
                extraDetails += `<details class="ransom-infostealer-details"><summary>Ver Tácticas MITRE ATT&CK</summary><pre>${data.ttps.join(', ')}</pre></details>`;
            }
            if (data.tools && typeof data.tools === 'object') {
                const toolsStr = Object.entries(data.tools).map(([cat, tArr]) => `${cat}:\n  ${tArr.join(', ')}`).join('\n\n');
                extraDetails += `<details class="ransom-infostealer-details"><summary>Ver Herramientas Usadas</summary><pre>${toolsStr}</pre></details>`;
            }

            content = `
                <div class="card card-wide">
                    <div class="card-header" style="justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:10px">
                            <span class="card-icon">👥</span><h2 style="color:var(--danger); text-transform:uppercase;">GRUPO: ${esc(data.name || 'Desconocido')}</h2>
                        </div>
                        ${data.url ? `<a href="${esc(data.url)}" target="_blank" class="btn-primary" style="padding: 4px 10px; font-size:12px; height:auto; text-decoration:none;">Ver Perfil ↗</a>` : ''}
                    </div>
                    <div class="card-body">
                        ${data.description ? `<div style="margin-bottom:15px; font-size:0.95rem; line-height:1.6">${esc(data.description)}</div>` : ''}
                        
                        <div style="display:flex; gap:8px; margin-bottom:15px; flex-wrap:wrap">
                            ${badges.join('')}
                        </div>

                        <div class="data-row"><span class="data-label">Víctimas Totales</span><span class="data-val" style="font-weight:bold; color:var(--text)">${esc(data.victims)}</span></div>
                        <div class="data-row"><span class="data-label">Actividad Registrada</span><span class="data-val">${esc(data.firstseen)} — ${esc(data.lastseen)}</span></div>
                        
                        <div style="margin-top:20px; border-top:1px dashed var(--border); padding-top:15px">
                            <span class="data-label" style="display:block; margin-bottom:8px">Ubicaciones (Leak sites / Chats)</span>
                            <div style="font-family:var(--mono); font-size:12px; background:rgba(0,0,0,0.15); padding:10px; border-radius:6px; max-height:200px; overflow-y:auto">
                                ${locsHtml}
                            </div>
                        </div>

                        ${extraDetails ? `<div style="margin-top:15px">${extraDetails}</div>` : ''}
                    </div>
                </div>`;
        } else if (data.ioc_types && data.iocs && typeof data.iocs === 'object') {
            // Detalle de IOCs por Grupo
            content = `
                <div class="card card-wide">
                    <div class="card-header"><span class="card-icon">🎯</span><h2>IOCs — Grupo: ${esc(data.group || 'Desconocido')}</h2></div>
                    <div class="card-body">
                        ${data.ioc_types.map(type => {
                            const arr = data.iocs[type];
                            if (!arr || arr.length === 0) return '';
                            return `
                                <div style="margin-bottom:20px;">
                                    <div style="font-weight:bold; color:var(--danger); text-transform:uppercase; margin-bottom:8px;">${esc(type)} (${arr.length})</div>
                                    <div style="font-family:var(--mono); font-size:12px; background:rgba(0,0,0,0.2); padding:12px; border-radius:6px; max-height:250px; overflow-y:auto; word-break:break-all; line-height:1.5;">
                                        ${arr.map(v => `<div>${esc(v)}</div>`).join('')}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>`;
        } else if (data.stats && typeof data.stats === 'object') {
            // Dashboard de estadísticas global muy premium
            const s = data.stats;
            const updatedDate = data.last_update ? new Date(data.last_update).toLocaleString() : 'N/A';
            content = `
                <div class="card card-wide" style="border:1px solid rgba(255,255,255,0.05); background:linear-gradient(135deg, var(--bg2) 0%, rgba(20,24,33,0.95) 100%)">
                    <div class="card-header" style="border-bottom:1px solid rgba(255,255,255,0.05)">
                        <span class="card-icon">📊</span>
                        <h2>Panel de Estadísticas Globales</h2>
                    </div>
                    <div class="card-body" style="padding:24px; display:flex; flex-direction:column; gap:24px">
                        <!-- Fila de Estadísticas -->
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:20px">
                            <div style="background:rgba(255,77,106,0.05); border:1px solid rgba(255,77,106,0.15); padding:20px; border-radius:12px; text-align:center; transition:transform 0.2s" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
                                <div style="font-size:12px; color:var(--danger); font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px">💀 Víctimas Totales</div>
                                <div style="font-size:32px; font-weight:800; color:var(--text); text-shadow:0 0 10px rgba(255,77,106,0.2)">${esc(Number(s.victims || 0).toLocaleString())}</div>
                            </div>
                            <div style="background:rgba(88,166,255,0.05); border:1px solid rgba(88,166,255,0.15); padding:20px; border-radius:12px; text-align:center; transition:transform 0.2s" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
                                <div style="font-size:12px; color:#58a6ff; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px">👥 Grupos Activos</div>
                                <div style="font-size:32px; font-weight:800; color:var(--text); text-shadow:0 0 10px rgba(88,166,255,0.2)">${esc(Number(s.groups || 0).toLocaleString())}</div>
                            </div>
                            <div style="background:rgba(137,87,229,0.05); border:1px solid rgba(137,87,229,0.15); padding:20px; border-radius:12px; text-align:center; transition:transform 0.2s" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
                                <div style="font-size:12px; color:#c9a4ff; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px">📰 Casos en Prensa</div>
                                <div style="font-size:32px; font-weight:800; color:var(--text); text-shadow:0 0 10px rgba(137,87,229,0.2)">${esc(Number(s.press || 0).toLocaleString())}</div>
                            </div>
                        </div>

                        <!-- Información de Cliente y Metadatos -->
                        <div style="background:rgba(0,0,0,0.15); border-radius:10px; padding:16px; border:1px solid rgba(255,255,255,0.03); display:flex; flex-direction:column; gap:10px; font-size:13px">
                            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.03); padding-bottom:8px">
                                <span style="color:var(--text-dim)">👤 Licencia / Cliente:</span>
                                <span style="font-weight:600; color:var(--text); font-family:var(--mono)">${esc(data.client)}</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center">
                                <span style="color:var(--text-dim)">⏳ Última Actualización API:</span>
                                <span style="font-weight:500; color:var(--text)">${esc(updatedDate)}</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        } else {
            // Stats o genérico fallback
            content = `
                <div class="card card-wide">
                    <div class="card-header"><span class="card-icon">📊</span><h2>Estadísticas / Info</h2></div>
                    <div class="card-body">
                        ${Object.entries(data).map(([k,v]) => {
                            if (typeof v === 'object' && v !== null) {
                                return Object.entries(v).map(([sk,sv]) => `
                                    <div class="data-row">
                                        <span class="data-label">${esc(k)}.${esc(sk)}</span>
                                        <span class="data-val">${esc(sv)}</span>
                                    </div>
                                `).join('');
                            }
                            return `
                                <div class="data-row">
                                    <span class="data-label">${esc(k)}</span>
                                    <span class="data-val">${esc(v)}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>`;
        }
        grid.innerHTML = content;
        return;
    }

    const first = data[0];
    
    // 2. Grupos de Ransomware (lista)
    if (first.name && first.locations !== undefined) {
        grid.innerHTML = data.map(g => `
            <div class="card">
                <div class="card-header" style="justify-content:center"><h2 style="color:var(--danger)">${esc(g.name)}</h2></div>
                <div class="card-body">
                    ${g.victims !== undefined ? `<div class="data-row"><span class="data-label">Víctimas</span><span class="data-val">${esc(g.victims)}</span></div>` : ''}
                    ${g.locations ? `<div class="data-row"><span class="data-label">Ubicaciones</span><span class="data-val" style="word-break:break-all; max-height:80px; overflow-y:auto; font-size:11px">${esc(g.locations)}</span></div>` : ''}
                </div>
            </div>
        `).join('');
        return;
    }

    // 3. Víctimas y Prensa (tienen victim, attackdate, discovered, post_title, date o domain)
    if (first.victim || first.post_title || first.attackdate || first.discovered || first.date || first.domain) {
        grid.innerHTML = data.map(v => {
            // Fechas separadas (contemplando endpoints de ciberataques en prensa)
            const rawAttack = v.attackdate || v.date;
            const rawDisc = v.discovered || v.added;
            const attackDate = rawAttack ? new Date(rawAttack).toLocaleDateString() : 'N/A';
            const discDate = rawDisc ? new Date(rawDisc).toLocaleDateString() : 'N/A';

            const imgHtml = v.screenshot 
                ? `<img src="${esc(v.screenshot)}" alt="Screenshot" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                   <div class="ransom-img-fallback" style="display:none">📷</div>`
                : `<div class="ransom-img-fallback">🔒</div>`;
                
            const countryHtml = v.country ? `<strong>${esc(v.country)}</strong>` : 'N/A';
            const domainHtml = v.website 
                ? `<span class="ransom-detail" title="Sitio Web">🌐 <strong>${esc(v.website)}</strong></span>` 
                : (v.domain ? `<span class="ransom-detail" title="Dominio">🌐 <strong>${esc(v.domain)}</strong></span>` : '');
                
            // Descripción o resumen
            const rawDesc = v.description || v.summary;
            const descText = rawDesc && rawDesc !== 'N/A' ? esc(rawDesc) : 'Sin descripción disponible.';

            // Extras (Press / Infostealer / Sector / Ransom / Size / Tor)
            let extrasHtml = '';
            let infostealerHtml = '';

            if (v.press) {
                extrasHtml += `<a href="${esc(v.press)}" target="_blank" class="ransom-badge press-badge" title="Mención en Prensa">📰 Prensa</a>`;
            }
            
            if (v.infostealer && v.infostealer !== 'N/A') {
                const hasData = (typeof v.infostealer === 'object' && Object.keys(v.infostealer).length > 0) || (typeof v.infostealer === 'string' && v.infostealer.length > 0) || Array.isArray(v.infostealer);
                if (hasData) {
                    extrasHtml += `<span class="ransom-badge info-badge" title="Datos de Infostealers detectados">🪲 Infostealer</span>`;
                    let details = '';
                    if (typeof v.infostealer === 'object') {
                        details = Object.entries(v.infostealer).map(([k,val]) => {
                            if (typeof val === 'object' && val !== null) {
                                const entries = Object.entries(val);
                                if (entries.length === 0) {
                                    return `${esc(k)}: {}`;
                                }
                                let sub = entries.map(([sk, sval]) => `  - ${sk}: ${sval}`).join('\n');
                                return `${esc(k)}:\n${sub}`;
                            }
                            return `${esc(k)}: ${esc(val)}`;
                        }).join('\n');
                    } else {
                        details = esc(v.infostealer);
                    }
                    infostealerHtml = `<details class="ransom-infostealer-details"><summary>Ver reporte de Infostealer</summary><pre>${details}</pre></details>`;
                }
            }
            
            if (v.activity) {
                extrasHtml += `<span class="ransom-badge sector-badge" title="Sector / Industria">🏭 ${esc(v.activity)}</span>`;
            }

            // Datos Pro adicionales
            if (v.ransom && v.ransom !== 'N/A') {
                extrasHtml += `<span class="ransom-badge ransom-amt-badge" title="Monto de Rescate Solicitado">💰 Rescate: ${esc(v.ransom)}</span>`;
            }
            if (v.data_size && v.data_size !== 'N/A') {
                extrasHtml += `<span class="ransom-badge size-badge" title="Tamaño de datos filtrados">📦 ${esc(v.data_size)}</span>`;
            }
            if (v.post_url) {
                extrasHtml += `<a href="${esc(v.post_url)}" target="_blank" class="ransom-badge tor-badge" title="Publicación original en red Tor (requiere Tor Browser)">🧅 Enlace Onion (Tor)</a>`;
            }

            // Nombre del atacante / grupo
            const groupName = v.group || v.group_name || (v.ransomware ? v.ransomware.group : '') || 'N/A';

            // Título de noticia
            const victimName = esc(v.victim || v.post_title || 'Desconocido');
            const articleTitleHtml = v.title && v.title !== v.victim 
                ? `<div class="ransom-subtitle" style="font-size:12px; color:var(--text-dim); margin-top:2px; font-style:italic" title="${esc(v.title)}">${esc(v.title)}</div>` 
                : '';

            // Múltiples enlaces de acción
            let links = [];
            const finalPermalink = v.permalink || (v.ransomware ? v.ransomware.permalink : '');
            if (finalPermalink) {
                links.push(`<a href="${esc(finalPermalink)}" target="_blank" class="ransom-link" style="color:var(--accent)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>Ver en Ransomware.live</a>`);
            }
            if (v.claim_url) {
                links.push(`<a href="${esc(v.claim_url)}" target="_blank" class="ransom-link" style="color:var(--danger)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>Ver Publicación</a>`);
            }
            if (v.url) {
                links.push(`<a href="${esc(v.url)}" target="_blank" class="ransom-link" style="color:var(--primary)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>Ver Artículo de Prensa</a>`);
            }

            const linksHtml = links.length > 0 
                ? links.join('<span style="color:var(--text-dim); opacity:0.3; margin:0 6px">|</span>')
                : '';

            return `
                <div class="ransom-card">
                    <div class="ransom-img-container">
                        ${imgHtml}
                    </div>
                    <div class="ransom-card-body">
                        <div class="ransom-card-header">
                            <div>
                                <h3 class="ransom-victim">${victimName}</h3>
                                ${articleTitleHtml}
                            </div>
                            <span class="ransom-group">${esc(groupName)}</span>
                        </div>
                        <div style="display:flex; gap:12px; flex-wrap:wrap">
                            <span class="ransom-detail" title="Fecha Estimada del Ataque">⚔️ Ataque: <strong>${attackDate}</strong></span>
                            <span class="ransom-detail" title="Fecha de Descubrimiento">👀 Detectado: <strong>${discDate}</strong></span>
                            <span class="ransom-detail" title="País">📍 ${countryHtml}</span>
                            ${domainHtml}
                        </div>
                        ${extrasHtml ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px">${extrasHtml}</div>` : ''}
                        <div class="ransom-desc" title="${descText}">${descText}</div>
                        ${infostealerHtml}
                        ${linksHtml ? `<div class="ransom-actions">${linksHtml}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        return;
    }

    // 4. Contactos CSIRT
    if (first.cert || first.email || first.phone) {
        grid.innerHTML = data.map(c => `
            <div class="card">
                <div class="card-header"><span class="card-icon">🚨</span><h2>${esc(c.cert || c.name || 'CERT')}</h2></div>
                <div class="card-body">
                    ${c.website ? `<div class="data-row"><span class="data-label">Web</span><a href="${esc(c.website)}" target="_blank" class="data-val" style="color:var(--primary)">${esc(c.website)}</a></div>` : ''}
                    ${c.email ? `<div class="data-row"><span class="data-label">Email</span><span class="data-val">${esc(c.email)}</span></div>` : ''}
                    ${c.phone ? `<div class="data-row"><span class="data-label">Teléfono</span><span class="data-val">${esc(c.phone)}</span></div>` : ''}
                </div>
            </div>
        `).join('');
        return;
    }

    // 5. Reglas YARA (strings o objetos)
    if (typeof first === 'string' || first.content) {
        grid.className = ''; 
        grid.innerHTML = `
            <div class="card card-wide">
                <div class="card-header"><span class="card-icon">📜</span><h2>Reglas YARA / Notas de Rescate</h2></div>
                <div class="card-body" style="background:rgba(0,0,0,0.3); padding:15px; border-radius:8px; font-family:monospace; white-space:pre-wrap; font-size:0.85rem; overflow-x:auto; line-height:1.5">
                    ${data.map(y => typeof y === 'string' ? esc(y) : esc(y.content || y.filename || JSON.stringify(y))).join('\n\n')}
                </div>
            </div>`;
        return;
    }

    // 6. IOCs
    if (first.type && first.value) {
        grid.innerHTML = data.map(ioc => `
            <div class="card">
                <div class="card-header"><span class="card-icon">🎯</span><h2>${esc(ioc.type.toUpperCase())}</h2></div>
                <div class="card-body" style="word-break:break-all; font-family:var(--mono); font-size:13px;">
                    ${esc(ioc.value)}
                </div>
            </div>
        `).join('');
        return;
    }
}

function initHistory() {
    ['ip', 'dns', 'whois', 'prop', 'ransom'].forEach(tab => {
        renderHistory(tab);
        const input = document.getElementById(tab + 'Input');
        const dropdown = document.getElementById('history-' + tab);
        if (input && dropdown) {
            input.addEventListener('focus', () => {
                if (getHistory(tab).length > 0) dropdown.classList.remove('hidden');
            });
            input.addEventListener('blur', () => {
                setTimeout(() => dropdown.classList.add('hidden'), 150);
            });
        }
    });
}

/* ══════════════════════════════════════════════════
   MAC LOOKUP LOGIC
   ══════════════════════════════════════════════════ */
function buscarMAC() {
    const input = document.getElementById('macInput').value.trim();
    const clean = input.replace(/[^a-fA-F0-9]/g, '');
    if (clean.length < 6) return showToast('Dirección MAC o prefijo OUI inválido (al menos 6 caracteres hex)', 'warning');
    
    const els = { res: 'mac-resultado', err: 'mac-error', load: 'mac-loading' };
    toggleLoadingState(els, true);

    apiFetch(`api/macvendors.php?mac=${encodeURIComponent(input)}`)
        .then(data => {
            
            // Formatear e inyectar valores
            document.getElementById('mac-vendor-val').textContent = data.vendor || 'Desconocido';
            document.getElementById('mac-queried-val').textContent = data.mac.toUpperCase();
            
            // Formatear el prefijo OUI (primeros 6 caracteres formateados en pares de 2 separados por dos puntos)
            const ouiHex = clean.substring(0, 6).toUpperCase();
            const formattedOui = ouiHex.match(/.{1,2}/g).join(':');
            document.getElementById('mac-oui-val').textContent = formattedOui;
            
            document.getElementById('mac-source-val').textContent = data.source;

            toggleLoadingState(els, false, true);
        })
        .catch(err => toggleLoadingState(els, false, false, err.message));
}
