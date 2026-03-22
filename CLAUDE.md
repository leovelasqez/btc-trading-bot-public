# BTC Futures Trading Bot — Proyecto de Leo (@0x4Leo)

## Visión General

Bot de trading automatizado para BTC/USDT Futures en Binance que:
1. Monitorea precio en 4 timeframes (15m, 1h, 4h, 1d)
2. Calcula indicadores técnicos + obtiene datos de mercado (OI, L/S ratio, order book, funding, liquidaciones)
3. Envía datos a Gemini AI para análisis (data-only, sin imágenes)
4. Recibe señal: LONG / SHORT / WAIT con confidence score + tipo de orden (MARKET o LIMIT)
5. Si hay posición abierta → gestión AI (ajustar SL/TP, cerrar, mantener)
6. Si hay limit order pendiente → gestión AI (mantener, cancelar, reemplazar)
7. Ejecuta en modo full-auto y notifica por Telegram
8. Logea todo en Supabase
9. Sincroniza automáticamente trades cerrados por SL/TP en Binance con Supabase

## Stack Tecnológico

- **Runtime**: Node.js 20+ con TypeScript (ESM)
- **Exchange**: Binance Futures via `ccxt` + endpoints directos FAPI
- **AI**: Google Gemini API via `@google/generative-ai`
  - Principal: `gemini-3.1-pro-preview` (mejor razonamiento)
  - Fallback: `gemini-2.5-pro` (estable, GA)
  - Retry: 3 intentos con backoff (60s, 180s, 300s) + 1 intento fallback
- **Liquidaciones**: WebSocket en tiempo real (`btcusdt@forceOrder`) con buffer de 1 hora
- **User Data Stream**: WebSocket para detectar fills de limit orders en tiempo real
- **Alertas**: Telegram Bot API via `node-telegram-bot-api`
- **Database**: Supabase (PostgreSQL)
- **Validation**: `zod` para schemas de respuesta AI y env vars
- **Deployment**: VPS Hostinger (Brasil - São Paulo) con PM2

## Arquitectura de Módulos

```
src/
├── config/
│   ├── env.ts                  # Variables de entorno (zod validated)
│   ├── logger.ts               # Logging estructurado (pino)
│   └── constants.ts            # Timeframes, indicadores, thresholds
├── exchange/
│   ├── binance.ts              # Wrapper ccxt para Binance Futures (fetchCurrencies: false)
│   ├── candles.ts              # Fetch de velas multi-timeframe (15m, 1h, 4h, 1d)
│   ├── liquidation-ws.ts       # WebSocket collector de liquidaciones en tiempo real
│   ├── user-data-ws.ts         # WebSocket User Data Stream (fill detection para limit orders)
│   ├── market-data.ts          # OI (FAPI directo), L/S ratio, order book, mark premium
│   ├── position-data.ts        # Datos de posición abierta + costos (comisiones, funding)
│   └── orders.ts               # Órdenes (market, limit, SL, TP), margin mode (CROSS), leverage
├── analysis/
│   ├── indicators.ts           # RSI, EMA, MACD, Bollinger, ATR, OBV, VWAP, microestructura
│   ├── chart-generator.ts      # Genera imágenes PNG de charts
│   └── context-builder.ts      # Empaqueta datos + indicadores para Gemini
├── ai/
│   ├── gemini-client.ts        # Cliente Gemini con retry + fallback (señales, posición, limit orders)
│   ├── prompt-template.ts      # Prompt para análisis de señales nuevas (MARKET/LIMIT)
│   ├── response-parser.ts      # Parseo + validación zod de señales
│   ├── position-prompt.ts      # Prompt para gestión de posición abierta
│   ├── position-response-parser.ts  # Parseo + validación zod de gestión
│   ├── limit-order-prompt.ts   # Prompt para gestión de limit orders pendientes
│   └── limit-order-response-parser.ts  # Parseo + validación zod (KEEP/CANCEL/REPLACE)
├── risk/
│   ├── position-sizer.ts       # 100% del balance con leverage 5x para todos los trades
│   └── circuit-breaker.ts      # Max drawdown diario, max trades/día, pausa manual
├── execution/
│   ├── trade-executor.ts       # Ejecuta trades MARKET (entry + SL/TP) y LIMIT (solo orden)
│   └── position-manager.ts     # Gestión AI de posición abierta (ajustar SL/TP, cerrar)
├── notifications/
│   ├── telegram-bot.ts         # Bot de Telegram (notificaciones informativas)
│   └── alert-formatter.ts      # Formato de mensajes de alerta
├── storage/
│   ├── supabase-client.ts      # Cliente Supabase
│   ├── trade-logger.ts         # Log de señales, decisiones, trades, ajustes
│   ├── run-migrations.ts       # Ejecutor de migrations
│   └── migrations/             # SQL migrations (001-004)
├── scheduler/
│   ├── cron.ts                 # Scheduler principal (cada 30 min)
│   ├── analysis-cycle.ts       # Ciclo de análisis + sync + fill handler + gestión limit orders
│   └── health-check.ts         # Monitoreo de salud del bot
├── startup-checks.ts            # Seguridad al arrancar + por ciclo (SL emergencia, limit orders huérfanas)
├── register-orphan-position.ts  # Script temporal: registra posición huérfana de Binance en Supabase
└── index.ts                    # Entry point
```

## Datos de Mercado

El bot obtiene datos de mercado de múltiples fuentes:

| Dato | Fuente | Método |
|------|--------|--------|
| Order Book (20 niveles) | ccxt `fetchOrderBook` | REST por ciclo |
| Open Interest | FAPI `/fapi/v1/openInterest` directo | REST por ciclo |
| Long/Short Ratio (global) | FAPI `/futures/data/globalLongShortAccountRatio` | REST por ciclo |
| Top Trader L/S Ratio | FAPI `/futures/data/topLongShortAccountRatio` | REST por ciclo |
| Top Trader Position Ratio | FAPI `/futures/data/topLongShortPositionRatio` | REST por ciclo |
| Taker Buy/Sell Volume | FAPI `/futures/data/takerlongshortRatio` | REST por ciclo |
| Mark/Index/Premium | ccxt `fetchFundingRate` | REST por ciclo |
| Liquidaciones | WebSocket `btcusdt@forceOrder` | Streaming continuo (buffer 1h) |
| Ticker 24h | ccxt `fetchTicker` | REST por ciclo |
| Price Performance | ccxt `fetchOHLCV` (1d, 365 velas) | REST por ciclo |

### Notas sobre endpoints
- `fetchCurrencies: false` en ccxt para evitar llamadas a SAPI (bloqueado por región)
- Open Interest usa endpoint FAPI directo en vez de ccxt (que internamente usa SAPI)
- Liquidaciones migradas de REST (deprecado por Binance) a WebSocket streaming
- Los endpoints `/futures/data/*` no funcionan en testnet, solo en mainnet

## Indicadores Técnicos (4 timeframes)

Calculados en 15m, 1h, 4h y 1d:
- **RSI** (14)
- **EMA** 9, 21, 50, 200
- **MACD** (12, 26, 9) + histograma
- **Bollinger Bands** (20, 2)
- **ATR** (14)
- **OBV** (On-Balance Volume)
- **VWAP**
- **Volume SMA** (20)
- **Microestructura**: delta de volumen, presión compradora/vendedora

## Convenciones de Código

- TypeScript strict mode (`"strict": true`)
- ESM modules (`"type": "module"` en package.json)
- Zod para TODA validación de datos externos (API responses, env vars)
- Async/await, nunca callbacks
- Logging estructurado con pino (timestamps ISO)
- Errores siempre tipados, nunca `catch(e: any)`
- Variables de entorno NUNCA hardcodeadas

## Variables de Entorno

```env
# Binance
BINANCE_API_KEY=
BINANCE_API_SECRET=
BINANCE_TESTNET=false          # false = mainnet (dinero real)

# Gemini AI
GEMINI_API_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Bot Config (con defaults)
TRADING_MODE=semi-auto         # semi-auto (default) | full-auto
LEVERAGE=5                     # Apalancamiento fijo (1-20)
MAX_POSITION_PCT=100           # % del balance por trade (1-100, default: 100%)
MAX_DAILY_LOSS_PCT=5           # Circuit breaker: max pérdida diaria (1-20)
MAX_TRADES_PER_DAY=10          # Circuit breaker: max trades por día (1-50)
ANALYSIS_INTERVAL_MINUTES=30   # Frecuencia de análisis (1-240)
CONFIDENCE_THRESHOLD=80        # Min confidence de Gemini para ejecutar (0-100, default: 80)
```

## Flujo Principal (cada ciclo)

### Sin posición abierta ni limit order pendiente (buscar señal)
1. `scheduler/cron.ts` dispara el ciclo cada 30 min (primer ciclo inmediato al iniciar)
2. Circuit breaker verifica si se puede operar (pausa manual, max trades, max loss)
3. `exchange/candles.ts` obtiene velas (15m, 1h, 4h, 1d) + `market-data.ts` obtiene OI, L/S, order book, liquidaciones
4. `analysis/indicators.ts` calcula indicadores técnicos en 4 timeframes
5. `analysis/context-builder.ts` empaqueta todo + calcula OI value en USDT
6. `ai/gemini-client.ts` envía datos a Gemini (con retry + fallback)
7. `ai/response-parser.ts` valida respuesta con zod (incluye `order_type: MARKET | LIMIT`)
8. Si confidence < CONFIDENCE_THRESHOLD (default 80%) → WAIT (rechazado)
9. Si confidence >= CONFIDENCE_THRESHOLD y señal LONG/SHORT → cancela órdenes pendientes existentes, luego ejecuta trade (MARKET o LIMIT según Gemini). En WAIT NO se cancelan órdenes ni posiciones.
10. Siempre notifica por Telegram (incluyendo señales WAIT)
11. `storage/trade-logger.ts` registra señal + decisión en Supabase

### Con posición abierta (gestión AI)
1. Detecta posición abierta en Binance
2. Obtiene datos de posición: entry, PnL, mark price, liquidation price
3. Calcula costos reales (comisiones entrada/salida + funding fees acumulados)
4. Calcula breakeven neto = entryPrice ± (totalCosts / quantity)
5. Gemini analiza con datos frescos de mercado y decide:
   - `HOLD` — mantener SL/TP actuales
   - `ADJUST_SL` — mover stop loss
   - `ADJUST_TP` — mover take profit
   - `ADJUST_BOTH` — ajustar ambos
   - `CLOSE` — cerrar posición
   - Umbral de confidence para gestión: **55%** (hardcodeado, más bajo que para entradas nuevas)
   - Si confidence < 55% → HOLD forzado (salvo acción `CLOSE`, que siempre se ejecuta)
6. Reglas hardcodeadas validan el SL (en orden, si falla alguna → SL rechazado):
   - **Regla 1**: Solo mover a favor (LONG: más arriba, SHORT: más abajo)
   - **Regla 2**: Si precio está en contra de la posición → rechazar completamente
   - **Regla 3**: Si precio en favor pero no cubre costos → SL máximo hasta entry price
   - **Regla 4**: SL no puede estar al precio actual o más allá (se ejecutaría inmediato)
7. Ejecuta ajustes, logea en Supabase, notifica por Telegram

### Con limit order pendiente (gestión AI)
1. Detecta limit order pendiente en tracking in-memory
2. Verifica que la orden aún existe en Binance
3. Gemini analiza con datos frescos y decide:
   - `KEEP` — mantener orden
   - `CANCEL` — cancelar orden
   - `REPLACE` — cancelar y colocar nueva orden (MARKET o LIMIT, nuevo precio/SL/TP)
4. Ejecuta decisión, notifica por Telegram

### Detección de fill (limit orders)
- WebSocket User Data Stream escucha `ORDER_TRADE_UPDATE` events
- Al detectar fill de una limit order tracked:
  1. Coloca SL/TP inmediatamente
  2. Registra trade en Supabase
  3. Notifica por Telegram
- ListenKey se renueva cada 25 min, reconexión forzada cada 23h

### Sincronización de trades cerrados
- Si Supabase marca un trade como "open" pero Binance no tiene posición
- Busca fills recientes en Binance posteriores al timestamp de apertura del trade
- Determina razón de cierre (SL/TP/manual) por comparación de precio
- Calcula PnL real, actualiza Supabase, notifica por Telegram

### Resiliencia Gemini
- 3 retries con backoff (60s, 180s, 300s) en modelo principal
- 1 intento con modelo fallback si principal agota retries
- Si ambos fallan → ciclo temprano adicional a los 15 min
- Solo retry en errores transitorios (503, fetch failed, timeout, ECONNRESET)

## Telegram Bot

### Comandos
- `/status` — Estado del bot (activo, modo, balance, PnL diario)
- `/pause` — Pausa el bot (deja de analizar)
- `/resume` — Reanuda el bot
- `/mode` — Muestra el modo de trading actual (semi-auto o full-auto)

### Modos de operación
- **`semi-auto`** (default) — envía señales con botones inline (✅ Ejecutar Trade / ❌ Ignorar) y espera confirmación del usuario antes de ejecutar
- **`full-auto`** — ejecuta trades automáticamente sin confirmación

### Alertas automáticas
- Señal de Gemini (LONG/SHORT/WAIT) con indicadores, sentimiento, confidence
- Ejecución de trade MARKET (confirmación con detalles)
- Orden LIMIT colocada (precio límite, cantidad, SL/TP pendientes)
- Orden LIMIT ejecutada (fill detectado, SL/TP colocados)
- Gestión de limit order (KEEP/CANCEL/REPLACE)
- Gestión de posición (HOLD/ADJUST/CLOSE con detalles SL/TP)
- Trade cerrado (PnL, razón: SL/TP/manual)
- Errores y health checks

## Circuit Breaker

Pausa automática del bot si:
1. **Pausa manual** — vía `/pause` en Telegram
2. **Max trades/día** — límite configurable (default: 10)
3. **Max pérdida diaria** — si loss >= threshold (default: 5% del balance)

Reset diario automático a las 00:00 UTC.

## Position Sizing

| Confidence | Margin Mode | Posición | Leverage |
|-----------|-------------|----------|----------|
| < CONFIDENCE_THRESHOLD (default 80%) | N/A | No se ejecuta | N/A |
| >= CONFIDENCE_THRESHOLD | CROSS | 100% del balance | 5x |

Siempre CROSS margin (Multi-Assets mode de Binance no permite ISOLATED).

## Ejecución de Trade

### Orden MARKET
1. Verificar que no hay posición abierta
2. Verificar balance suficiente
3. Circuit breaker check
4. Calcular position size (100% balance × leverage)
5. Configurar margin mode CROSS + leverage (try/catch, ignora si ya está configurado)
6. Cancelar órdenes previas
7. Abrir orden de mercado
8. Colocar stop loss (lado opuesto, `reduceOnly: true`)
9. Colocar take profit (si Gemini lo especificó, `reduceOnly: true`)
10. Registrar en Supabase
11. Notificar por Telegram

### Orden LIMIT
1-6. Mismos pasos que MARKET (margin/leverage + cancelar órdenes)
7. Colocar orden limit al precio indicado por Gemini
8. NO coloca SL/TP (se colocan cuando se detecta fill vía WebSocket)
9. NO registra en Supabase (se registra al detectar fill)
10. Tracking in-memory del orderId + SL/TP pendientes
11. Notificar por Telegram

## WebSocket de Liquidaciones

- Conexión persistente a `wss://fstream.binance.com/ws/btcusdt@forceOrder`
- Solo almacena órdenes con status `FILLED`
- Buffer en memoria con TTL de 1 hora (poda automática)
- Auto-reconexión con backoff exponencial (1s → 60s máximo)
- Se inicia al arrancar el bot, se detiene en shutdown
- Gemini usa las liquidaciones como "zonas magnéticas" de precio

## WebSocket User Data Stream

- Conexión a `wss://fstream.binance.com/ws/<listenKey>`
- ListenKey: POST `/fapi/v1/listenKey` (crear), PUT cada 25 min (renovar)
- Reconexión forzada cada 23h (Binance cierra a las 24h)
- Escucha `ORDER_TRADE_UPDATE` con `executionType: TRADE` y `orderType: LIMIT`
- Al detectar fill: coloca SL/TP, registra trade, notifica
- Auto-reconexión con backoff exponencial (misma lógica que liquidaciones)

## Health Check

- Alerta si no hay análisis en > 30 minutos
- Monitorea errores recientes (< 5 min)
- Verifica estado de pausa del bot

## Scripts Utilitarios

- **`register-orphan-position.ts`** — Registra en Supabase una posición que existe en Binance pero no tiene trade asociado (ej: abierta manualmente). Lee posición + SL/TP de Binance, crea cadena signal → ai_decision → trade en Supabase. Si no hay SL, coloca uno al 3% automáticamente. Uso: `node dist/register-orphan-position.js`

## Módulo startup-checks.ts

Dos funciones de seguridad:
- **`checkStartupSafety()`** — Se ejecuta al arrancar el bot:
  - Si hay posición sin SL → coloca SL de emergencia al 3% desde el entry
  - Si hay limit orders sin tracking en memoria (tras reinicio) → las cancela (SL/TP desconocidos)
- **`ensurePositionHasSL(positionData)`** — Se ejecuta en cada ciclo si hay posición abierta:
  - Verifica que sigue existiendo una orden STOP_MARKET
  - Si no hay SL (ej: fill de limit order perdido por WebSocket) → coloca SL de emergencia al 3%

## Reglas de Seguridad (NO NEGOCIABLES)

- NUNCA ejecutar sin stop loss
- Circuit breaker se activa con max drawdown diario → bot se pausa
- Gemini confidence < CONFIDENCE_THRESHOLD (default 80%) → NO se ejecuta, se logea como "rejected"
- Si Gemini API falla → NO se ejecuta, se notifica error, se agenda retry
- Todas las API keys en .env, NUNCA en código
- SL solo se mueve a favor, nunca en contra de la posición
- `fetchCurrencies: false` siempre (evitar SAPI bloqueado por región)
- Siempre CROSS margin (Multi-Assets mode no permite ISOLATED)
- SL/TP usan `reduceOnly: true` (NUNCA `closePosition: true` — causa error -4130 al ajustar)
- Al ajustar SL o TP: cancelar TODAS las órdenes y re-colocar ambas (SL + TP)
- Limpieza de órdenes previas: solo cuando Gemini decide LONG/SHORT, NUNCA en WAIT. No se cierran posiciones, solo se cancelan órdenes pendientes
- `setMarginMode` y `setLeverage` van en try/catch (ignoran error si ya están configurados, evita -4067)
