'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

const WORLD_W = 720;
const WORLD_H = 560;
const RUN_SECONDS = 60;

type Phase = 'ready' | 'running' | 'paused' | 'over';
type FallingThing = {
  id: number;
  kind: 'shard' | 'comet';
  x: number;
  y: number;
  size: number;
  speed: number;
  rotation: number;
  spin: number;
};

type GameState = {
  phase: Phase;
  score: number;
  lives: number;
  multiplier: number;
  timeLeft: number;
  shipX: number;
  entities: FallingThing[];
  nextId: number;
  shardClock: number;
  cometClock: number;
  invulnerableUntil: number;
  flashUntil: number;
};

type WebMCPContext = {
  registerTool: (tool: {
    name: string;
    title?: string;
    description: string;
    inputSchema: object;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    execute: (input: unknown) => unknown;
  }, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

const initialGame = (): GameState => ({
  phase: 'ready',
  score: 0,
  lives: 3,
  multiplier: 1,
  timeLeft: RUN_SECONDS,
  shipX: WORLD_W / 2,
  entities: [],
  nextId: 1,
  shardClock: 0.45,
  cometClock: 1.4,
  invulnerableUntil: 0,
  flashUntil: 0,
});

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameState>(initialGame());
  const heldRef = useRef({ left: false, right: false });
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const lastHudRef = useRef(0);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, setHud] = useState({ score: 0, lives: 3, multiplier: 1, timeLeft: RUN_SECONDS });
  const [best, setBest] = useState(0);
  const [announcement, setAnnouncement] = useState('Comet Circuit ready.');

  const syncHud = useCallback(() => {
    const game = gameRef.current;
    setHud({
      score: game.score,
      lives: game.lives,
      multiplier: game.multiplier,
      timeLeft: Math.max(0, Math.ceil(game.timeLeft)),
    });
  }, []);

  const finishGame = useCallback((reason: 'time' | 'shield') => {
    const game = gameRef.current;
    if (game.phase === 'over') return;
    game.phase = 'over';
    heldRef.current = { left: false, right: false };
    setPhase('over');
    syncHud();
    const finalScore = Math.floor(game.score);
    setBest((previous) => {
      const next = Math.max(previous, finalScore);
      try {
        localStorage.setItem('comet-circuit-best', String(next));
      } catch {}
      return next;
    });
    setAnnouncement(`${reason === 'time' ? 'Time complete' : 'Shield depleted'}. Final score ${finalScore}.`);
    window.setTimeout(() => primaryActionRef.current?.focus(), 80);
  }, [syncHud]);

  const startGame = useCallback(() => {
    const next = initialGame();
    next.phase = 'running';
    gameRef.current = next;
    heldRef.current = { left: false, right: false };
    lastFrameRef.current = performance.now();
    setPhase('running');
    syncHud();
    setAnnouncement('Run started. Sixty seconds remaining.');
    window.setTimeout(() => canvasRef.current?.focus(), 80);
  }, [syncHud]);

  const togglePause = useCallback(() => {
    const game = gameRef.current;
    if (game.phase === 'running') {
      game.phase = 'paused';
      heldRef.current = { left: false, right: false };
      setPhase('paused');
      setAnnouncement('Game paused.');
    } else if (game.phase === 'paused') {
      game.phase = 'running';
      lastFrameRef.current = performance.now();
      setPhase('running');
      setAnnouncement('Game resumed.');
      canvasRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('comet-circuit-best'));
      if (Number.isFinite(saved) && saved > 0) {
        queueMicrotask(() => setBest(Math.floor(saved)));
      }
    } catch {}
  }, []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMCPContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<WebMCPContext['registerTool']>[0]) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
      } catch {}
    };
    register({
      name: 'start_comet_circuit_run',
      title: 'Start Comet Circuit run',
      description: 'Start or restart a visible sixty-second Comet Circuit game run.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Input must be an empty object.');
        startGame();
        return { phase: 'running', timeLeft: RUN_SECONDS, lives: 3 };
      },
    });
    register({
      name: 'set_comet_circuit_pause',
      title: 'Pause or resume Comet Circuit',
      description: 'Pause or resume the current visible game run.',
      inputSchema: { type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const value = input as { paused?: unknown } | null;
        if (!value || typeof value.paused !== 'boolean') throw new Error('paused must be a boolean.');
        const current = gameRef.current.phase;
        if (value.paused && current === 'running') togglePause();
        if (!value.paused && current === 'paused') togglePause();
        return { phase: gameRef.current.phase };
      },
    });
    register({
      name: 'get_comet_circuit_status',
      title: 'Read Comet Circuit status',
      description: 'Read the current visible score, time, shields, multiplier, and game phase.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Input must be an empty object.');
        const game = gameRef.current;
        return { phase: game.phase, score: Math.floor(game.score), timeLeft: Math.max(0, Math.ceil(game.timeLeft)), lives: game.lives, multiplier: game.multiplier };
      },
    });
    return () => lifecycle.abort();
  }, [startGame, togglePause]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const game = gameRef.current;
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
        heldRef.current.left = true;
        if (game.phase === 'running') event.preventDefault();
      }
      if (event.code === 'ArrowRight' || event.code === 'KeyD') {
        heldRef.current.right = true;
        if (game.phase === 'running') event.preventDefault();
      }
      if ((event.code === 'Space' || event.code === 'KeyP') && !event.repeat) {
        if (game.phase === 'running' || game.phase === 'paused') {
          event.preventDefault();
          togglePause();
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') heldRef.current.left = false;
      if (event.code === 'ArrowRight' || event.code === 'KeyD') heldRef.current.right = false;
    };
    const onBlur = () => { heldRef.current = { left: false, right: false }; };
    const onVisibility = () => {
      if (document.hidden && gameRef.current.phase === 'running') {
        gameRef.current.phase = 'paused';
        heldRef.current = { left: false, right: false };
        setPhase('paused');
        setAnnouncement('Game paused while this tab was hidden.');
      }
    };
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [togglePause]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(bounds.width * dpr));
      canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const spawn = (kind: FallingThing['kind'], difficulty: number) => {
      const game = gameRef.current;
      if (game.entities.length >= 32) return;
      const size = kind === 'shard' ? 13 + Math.random() * 5 : 21 + Math.random() * 14;
      game.entities.push({
        id: game.nextId++, kind,
        x: 42 + Math.random() * (WORLD_W - 84), y: -size - 10, size,
        speed: kind === 'shard' ? 135 + Math.random() * 55 : 120 + difficulty * 85 + Math.random() * 70,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 2.6,
      });
    };

    const update = (dt: number, now: number) => {
      const game = gameRef.current;
      if (game.phase !== 'running') return;
      const difficulty = 1 - game.timeLeft / RUN_SECONDS;
      game.timeLeft -= dt;
      const direction = Number(heldRef.current.right) - Number(heldRef.current.left);
      game.shipX = Math.max(35, Math.min(WORLD_W - 35, game.shipX + direction * 360 * dt));
      game.shardClock -= dt;
      game.cometClock -= dt;
      if (game.shardClock <= 0) { spawn('shard', difficulty); game.shardClock = 0.68 + Math.random() * 0.42; }
      if (game.cometClock <= 0) { spawn('comet', difficulty); game.cometClock = Math.max(0.38, 1.2 - difficulty * 0.55) + Math.random() * 0.48; }

      const shipY = WORLD_H - 54;
      let tookHit = false;
      game.entities = game.entities.filter((entity) => {
        entity.y += entity.speed * dt;
        entity.rotation += entity.spin * dt;
        if (entity.y - entity.size > WORLD_H + 16) return false;
        const dx = entity.x - game.shipX;
        const dy = entity.y - shipY;
        const radius = entity.size + 19;
        if (dx * dx + dy * dy < radius * radius) {
          if (entity.kind === 'shard') {
            game.score += 100 * game.multiplier;
            game.multiplier = Math.min(8, game.multiplier + 1);
            game.flashUntil = now + 90;
            return false;
          }
          if (now >= game.invulnerableUntil && !tookHit) {
            tookHit = true;
            game.lives -= 1;
            game.multiplier = 1;
            game.invulnerableUntil = now + 1100;
            game.flashUntil = now + 260;
            setAnnouncement(`${game.lives} shield ${game.lives === 1 ? 'charge' : 'charges'} remaining.`);
            return false;
          }
        }
        return true;
      });
      if (game.lives <= 0) finishGame('shield');
      else if (game.timeLeft <= 0) finishGame('time');
      if (now - lastHudRef.current > 100) { lastHudRef.current = now; syncHud(); }
    };

    const draw = (now: number) => {
      const game = gameRef.current;
      const sx = canvas.width / WORLD_W;
      const sy = canvas.height / WORLD_H;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      const gradient = ctx.createLinearGradient(0, 0, 0, WORLD_H);
      gradient.addColorStop(0, '#101531'); gradient.addColorStop(0.58, '#090d22'); gradient.addColorStop(1, '#070917');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.strokeStyle = 'rgba(112, 240, 232, 0.08)'; ctx.lineWidth = 1;
      for (let x = 0; x <= WORLD_W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke(); }
      for (let y = 8; y <= WORLD_H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke(); }
      for (let i = 0; i < 34; i++) {
        const x = (i * 83.71) % WORLD_W;
        const y = (i * 127.3 + now * (0.006 + (i % 3) * 0.002)) % WORLD_H;
        ctx.fillStyle = i % 4 === 0 ? 'rgba(255, 216, 110, .55)' : 'rgba(211, 230, 255, .36)';
        ctx.fillRect(x, y, i % 5 === 0 ? 2 : 1.2, i % 5 === 0 ? 2 : 1.2);
      }
      game.entities.forEach((entity) => {
        ctx.save(); ctx.translate(entity.x, entity.y); ctx.rotate(entity.rotation);
        if (entity.kind === 'shard') {
          ctx.shadowColor = '#72f5e9'; ctx.shadowBlur = 18; ctx.fillStyle = '#72f5e9';
          ctx.beginPath(); ctx.moveTo(0, -entity.size); ctx.lineTo(entity.size * 0.65, 0); ctx.lineTo(0, entity.size); ctx.lineTo(-entity.size * 0.65, 0); ctx.closePath(); ctx.fill();
          ctx.shadowBlur = 0; ctx.strokeStyle = '#fff6ae'; ctx.lineWidth = 2; ctx.stroke();
        } else {
          ctx.shadowColor = '#ff5f6d'; ctx.shadowBlur = 12; ctx.fillStyle = '#ff6575'; ctx.beginPath();
          const points = 9;
          for (let i = 0; i < points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const radius = entity.size * (i % 2 ? 0.8 : 1);
            const px = Math.cos(angle) * radius; const py = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#8d2947';
          ctx.beginPath(); ctx.arc(-entity.size * .22, -entity.size * .16, entity.size * .18, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(entity.size * .25, entity.size * .2, entity.size * .11, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      });

      const shipY = WORLD_H - 54;
      const blinking = now < game.invulnerableUntil && Math.floor(now / 90) % 2 === 0;
      if (!blinking) {
        ctx.save(); ctx.translate(game.shipX, shipY); ctx.shadowColor = '#72f5e9'; ctx.shadowBlur = 24; ctx.fillStyle = '#eaffff';
        ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(28, 23); ctx.lineTo(7, 15); ctx.lineTo(0, 25); ctx.lineTo(-7, 15); ctx.lineTo(-28, 23); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#5cecdf'; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(8, 13); ctx.lineTo(-8, 13); ctx.closePath(); ctx.fill();
        if (game.phase === 'running') { ctx.fillStyle = '#ffd86e'; ctx.beginPath(); ctx.moveTo(-7, 25); ctx.lineTo(0, 41 + Math.sin(now / 55) * 4); ctx.lineTo(7, 25); ctx.closePath(); ctx.fill(); }
        ctx.restore();
      }
      if (now < game.flashUntil) { ctx.fillStyle = 'rgba(114,245,233,.07)'; ctx.fillRect(0, 0, WORLD_W, WORLD_H); }
      if (game.phase === 'paused') { ctx.fillStyle = 'rgba(4, 6, 20, .42)'; ctx.fillRect(0, 0, WORLD_W, WORLD_H); }
    };

    const frame = (now: number) => {
      const rawDelta = lastFrameRef.current ? (now - lastFrameRef.current) / 1000 : 0;
      lastFrameRef.current = now;
      update(Math.min(rawDelta, 0.05), now);
      draw(now);
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [finishGame, syncHud]);

  const setHeld = (side: 'left' | 'right', value: boolean) => {
    heldRef.current[side] = value;
    if (value) canvasRef.current?.focus();
  };

  return (
    <main className="game-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#game" aria-label="Comet Circuit home"><span className="brand-mark"><Zap size={18} strokeWidth={2.6} /></span><span>COMET CIRCUIT</span></a>
        <div className="topbar-meta"><span>SECTOR 07</span><i /><span>ARCADE RUN</span></div>
      </header>

      <section className="game-layout" id="game" aria-labelledby="game-title">
        <div className="intro-copy">
          <p className="eyebrow">ONE SHIP · ONE MINUTE</p>
          <h1 id="game-title">Thread the<br /><em>meteor storm.</em></h1>
          <p className="lede">Collect energy shards. Dodge comets. Keep your multiplier alive until the circuit closes.</p>
          <div className="legend" aria-label="Game object legend"><span><b className="diamond" /> ENERGY</span><span><b className="meteor" /> DANGER</span></div>
          <div className="desktop-controls"><span><kbd>←</kbd><kbd>→</kbd> or <kbd>A</kbd><kbd>D</kbd> MOVE</span><span><kbd>SPACE</kbd> PAUSE</span></div>
        </div>

        <div className="arcade-frame">
          <div className="arcade-topline"><span>FLIGHT DECK</span><span className="status-dot">● ONLINE</span></div>
          <div className="hud" aria-label="Game status">
            <div><span>SCORE</span><strong>{hud.score.toString().padStart(6, '0')}</strong></div>
            <div><span>MULTIPLIER</span><strong className="cyan">×{hud.multiplier}</strong></div>
            <div><span>SHIELD</span><strong className="lives" aria-label={`${hud.lives} shield charges`}>{'◆'.repeat(hud.lives)}<i>{'◇'.repeat(3 - hud.lives)}</i></strong></div>
            <div><span>TIME</span><strong className={hud.timeLeft <= 10 ? 'danger' : ''}>{hud.timeLeft.toString().padStart(2, '0')}</strong></div>
          </div>

          <div className="screen-wrap">
            <canvas ref={canvasRef} tabIndex={0} className="game-canvas" aria-label="Comet Circuit play field. Use left and right arrow keys or A and D to steer." />
            {(phase === 'ready' || phase === 'over') && (
              <div className="game-overlay">
                <p className="overlay-kicker">{phase === 'ready' ? 'PILOT BRIEFING' : 'RUN COMPLETE'}</p>
                <h2>{phase === 'ready' ? 'Ready to launch?' : `${hud.score.toLocaleString()} points`}</h2>
                <p>{phase === 'ready' ? 'Grab cyan diamonds, avoid coral comets, and chain pickups for up to an 8× score.' : `Best flight: ${Math.max(best, hud.score).toLocaleString()} points.`}</p>
                <Button ref={primaryActionRef} onClick={startGame} size="lg" className="launch-button">
                  {phase === 'ready' ? <Play fill="currentColor" /> : <RotateCcw />}{phase === 'ready' ? 'START RUN' : 'FLY AGAIN'}
                </Button>
              </div>
            )}
            {phase === 'paused' && (
              <div className="game-overlay compact-overlay"><p className="overlay-kicker">SYSTEM HOLD</p><h2>Paused</h2><Button onClick={togglePause} size="lg" className="launch-button"><Play fill="currentColor" /> RESUME</Button></div>
            )}
          </div>

          <div className="mobile-controls" aria-label="Touch flight controls">
            <button type="button" aria-label="Move left" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHeld('left', true); }} onPointerUp={() => setHeld('left', false)} onPointerCancel={() => setHeld('left', false)} onLostPointerCapture={() => setHeld('left', false)}><ArrowLeft /></button>
            <button type="button" aria-label="Move right" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHeld('right', true); }} onPointerUp={() => setHeld('right', false)} onPointerCancel={() => setHeld('right', false)} onLostPointerCapture={() => setHeld('right', false)}><ArrowRight /></button>
          </div>
          <div className="cabinet-footer">
            <span>BEST <b>{best.toString().padStart(6, '0')}</b></span>
            {(phase === 'running' || phase === 'paused') && <button className="pause-button" type="button" onClick={togglePause} aria-label={phase === 'paused' ? 'Resume game' : 'Pause game'}>{phase === 'paused' ? <Play size={15} /> : <Pause size={15} />} {phase === 'paused' ? 'RESUME' : 'PAUSE'}</button>}
          </div>
        </div>
      </section>
      <p className="game-note">Built for quick hands and questionable judgment.</p>
      <output className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</output>
    </main>
  );
}
