import type {MarketBook} from '../types/marketDirectory';
import type {PerplBookDelta, PerplMarketStreamMessage, PerplPublicTrade, PerplStreamStatus} from '../types/perplMarketStream';
import {mergePublicTrades, parsePerplPublicFrame} from '../types/perplMarketStream';

const SOCKET_URL = 'wss://testnet.perpl.xyz/ws/v1/market-data';
const BASE_STREAMS = ['heartbeat@10143', 'market-config@10143', 'market-state@10143', 'funding@10143'];
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const HEARTBEAT_TIMEOUT_MS = 20_000;
const SUBSCRIPTION_ACK_TIMEOUT_MS = 10_000;

export type PerplMarketStreamLease = {
  marketId: string | null;
  resolutionSeconds: number;
  onMessage: (message: PerplMarketStreamMessage) => void;
  onStatus: (status: PerplStreamStatus) => void;
};
type Lease = PerplMarketStreamLease & {id: number};
type BookState = {bids: Map<number, PerplBookDelta>; asks: Map<number, PerplBookDelta>; observedAt: number; blockNumber?: number};

export class PerplMarketStreamClient {
  private socket: WebSocket | null = null;
  private leases = new Map<number, Lease>();
  private nextId = 1;
  private streamSids = new Map<number, string>();
  private activeStreams = new Set<string>();
  private pendingStreams = new Set<string>();
  private pendingRemovals = new Set<string>();
  private books = new Map<string, BookState>();
  private trades = new Map<string, PerplPublicTrade[]>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private ackWatchdog: ReturnType<typeof setTimeout> | null = null;
  private retry = 0;
  private lastHeartbeatAt = 0;
  private lastSequence: number | null = null;
  private status: PerplStreamStatus = 'disconnected';
  private forceClose = false;

  subscribe(input: PerplMarketStreamLease) {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const id = this.nextId++;
    this.leases.set(id, {...input, id});
    input.onStatus(this.status);
    if (!this.socket) this.connect();
    else { this.reconcileSubscriptions(); this.maybeConnected(); }
    return () => this.release(id);
  }

  private release(id: number) {
    this.leases.delete(id);
    if (this.leases.size) { this.reconcileSubscriptions(); return; }
    this.setStatus('disconnected');
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), 350);
  }

  private stop() {
    if (this.leases.size) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.ackWatchdog) clearTimeout(this.ackWatchdog);
    this.reconnectTimer = this.watchdog = this.ackWatchdog = null;
    this.forceClose = true;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.forceClose = false;
    this.streamSids.clear(); this.activeStreams.clear(); this.books.clear(); this.trades.clear();
    this.pendingStreams.clear(); this.pendingRemovals.clear();
    this.lastSequence = null; this.lastHeartbeatAt = 0; this.retry = 0;
  }

  private connect() {
    if (!this.leases.size || this.socket) return;
    this.setStatus('reconnecting');
    try {
      const socket = new WebSocket(SOCKET_URL);
      this.socket = socket;
      socket.onopen = () => {
        if (socket !== this.socket) return;
        this.lastHeartbeatAt = Date.now(); this.lastSequence = null;
        this.activeStreams.clear(); this.pendingStreams.clear(); this.pendingRemovals.clear();
        this.streamSids.clear(); this.books.clear(); this.trades.clear();
        this.setStatus('reconnecting');
        this.reconcileSubscriptions();
        if (this.watchdog) clearInterval(this.watchdog);
        this.watchdog = setInterval(() => this.checkHeartbeat(), 5_000);
      };
      socket.onmessage = event => { if (socket === this.socket) this.handleFrame(String(event.data)); };
      socket.onerror = () => { this.setStatus('reconnecting'); socket.close(); };
      socket.onclose = () => {
        if (socket !== this.socket) return;
        this.socket = null; this.activeStreams.clear(); this.pendingStreams.clear(); this.pendingRemovals.clear();
        this.streamSids.clear(); this.books.clear(); this.trades.clear();
        if (this.watchdog) clearInterval(this.watchdog);
        if (this.ackWatchdog) clearTimeout(this.ackWatchdog);
        this.watchdog = this.ackWatchdog = null;
        this.setStatus('reconnecting');
        if (!this.forceClose && this.leases.size) this.scheduleReconnect();
      };
    } catch {
      this.setStatus('reconnecting'); this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.leases.size) return;
    const delay = RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)];
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }

  private checkHeartbeat() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) return;
    this.emit({kind: 'gap', reason: 'heartbeat_timeout'});
    this.setStatus('reconnecting');
    this.socket.close();
  }

  private desiredStreams() {
    const desired = new Set(BASE_STREAMS);
    for (const lease of this.leases.values()) if (lease.marketId) {
      desired.add(`order-book@${lease.marketId}`);
      desired.add(`trades@${lease.marketId}`);
      desired.add(`candles@${lease.marketId}*${lease.resolutionSeconds}`);
    }
    return desired;
  }

  private reconcileSubscriptions() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const desired = this.desiredStreams();
    const changes = [
      ...[...desired].filter(stream => !this.activeStreams.has(stream) && !this.pendingStreams.has(stream)).map(stream => ({stream, subscribe: true})),
      ...[...this.activeStreams].filter(stream => !desired.has(stream) && !this.pendingRemovals.has(stream)).map(stream => ({stream, subscribe: false})),
    ];
    if (!changes.length) return;
    this.socket.send(JSON.stringify({mt: 5, subs: changes}));
    for (const item of changes) if (item.subscribe) this.pendingStreams.add(item.stream); else this.pendingRemovals.add(item.stream);
    if (changes.some(item => item.subscribe)) {
      if (this.ackWatchdog) clearTimeout(this.ackWatchdog);
      this.ackWatchdog = setTimeout(() => {
        this.ackWatchdog = null;
        if (this.pendingStreams.size) { this.setStatus('reconnecting'); this.socket?.close(); }
      }, SUBSCRIPTION_ACK_TIMEOUT_MS);
    }
    if ([...desired].some(stream => !this.activeStreams.has(stream))) this.setStatus('reconnecting');
  }

  private handleFrame(raw: string) {
    const messages = parsePerplPublicFrame(raw, this.streamSids);
    for (const message of messages) {
      if (message.kind === 'subscription') {
        for (const item of message.subscriptions) {
          if (item.code === 0) {
            if (item.sid !== undefined) this.streamSids.set(item.sid, item.stream);
            if (this.pendingRemovals.delete(item.stream)) {
              this.activeStreams.delete(item.stream);
              for (const [sid, stream] of this.streamSids) if (stream === item.stream) this.streamSids.delete(sid);
            } else { this.pendingStreams.delete(item.stream); this.activeStreams.add(item.stream); }
          } else {
            this.pendingStreams.delete(item.stream); this.pendingRemovals.delete(item.stream);
            this.setStatus('reconnecting'); this.socket?.close();
          }
        }
        this.maybeConnected();
        this.emit(message);
      }
      if (message.kind === 'heartbeat') {
        this.lastHeartbeatAt = Date.now(); this.retry = 0;
        if (this.lastSequence !== null && message.sequence > this.lastSequence + 1) {
          this.emit({kind: 'gap', reason: 'heartbeat_sequence_gap'});
          this.lastSequence = message.sequence; this.setStatus('reconnecting'); this.socket?.close();
          continue;
        }
        this.lastSequence = message.sequence;
        this.maybeConnected();
      }
      const hydrated = this.hydrateBookAndTrades(message);
      if (hydrated) this.emit(hydrated);
      else if (message.kind !== 'subscription' && message.kind !== 'heartbeat' && message.kind !== 'marketConfig') this.emit(message);
    }
  }

  private hydrateBookAndTrades(message: PerplMarketStreamMessage): PerplMarketStreamMessage | null {
    if (message.kind === 'book') {
      let state = this.books.get(message.marketId);
      if (message.snapshot) state = {bids: new Map(), asks: new Map(), observedAt: message.observedAt};
      if (!state) return null;
      if (message.snapshot || state) {
        applyLevels(state.bids, message.bids, message.snapshot); applyLevels(state.asks, message.asks, message.snapshot);
        state.observedAt = message.observedAt; state.blockNumber = message.blockNumber; this.books.set(message.marketId, state);
        return {kind: 'book', marketId: message.marketId, snapshot: true,
          bids: sortLevels(state.bids, true), asks: sortLevels(state.asks, false), observedAt: state.observedAt, blockNumber: state.blockNumber} as any;
      }
    }
    if (message.kind === 'trades') {
      const prior = this.trades.get(message.marketId) ?? [];
      const recent = message.snapshot ? mergePublicTrades([], message.trades) : mergePublicTrades(prior, message.trades);
      this.trades.set(message.marketId, recent);
      return {...message, trades: recent};
    }
    return null;
  }

  private emit(message: PerplMarketStreamMessage) {
    for (const lease of this.leases.values()) {
      if (['book', 'candles', 'trades'].includes(message.kind) && !lease.marketId) continue;
      if ('marketId' in message && message.marketId && lease.marketId && message.marketId !== lease.marketId) continue;
      if (message.kind === 'candles' && lease.marketId && message.resolutionSeconds !== lease.resolutionSeconds) continue;
      lease.onMessage(message);
    }
  }

  private maybeConnected() {
    const desired = this.desiredStreams();
    if ([...desired].every(stream => this.activeStreams.has(stream)) && this.pendingRemovals.size === 0) {
      this.retry = 0; this.setStatus('connected');
      if (this.ackWatchdog) clearTimeout(this.ackWatchdog);
      this.ackWatchdog = null;
    }
  }

  private setStatus(status: PerplStreamStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const lease of this.leases.values()) lease.onStatus(status);
  }
}

function applyLevels(book: Map<number, PerplBookDelta>, levels: PerplBookDelta[], replace: boolean) {
  if (replace) book.clear();
  for (const level of levels) {
    if (level.orders === 0 || level.size === 0) book.delete(level.price);
    else book.set(level.price, level);
  }
}
function sortLevels(book: Map<number, PerplBookDelta>, descending: boolean) {
  return [...book.values()].sort((a, b) => descending ? b.price - a.price : a.price - b.price).slice(0, 50);
}

export const perplMarketStreamClient = new PerplMarketStreamClient();
