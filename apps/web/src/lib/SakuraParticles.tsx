import { useEffect, useRef } from "react";

interface Petal {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  color: string;
  phase: number;
}

const COLORS = ["rgba(255,183,197,", "rgba(255,218,228,", "rgba(255,158,177,", "rgba(255,200,210,"];

function createPetal(canvasWidth: number, canvasHeight: number): Petal {
  return {
    x: Math.random() * canvasWidth * 1.1 - canvasWidth * 0.05,
    y: -10 - Math.random() * canvasHeight * 0.3,
    size: 6 + Math.random() * 12,
    speedX: -0.3 + Math.random() * 0.6,
    speedY: 0.6 + Math.random() * 1.8,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.03,
    opacity: 0.4 + Math.random() * 0.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    phase: Math.random() * Math.PI * 2
  };
}

export function SakuraParticles({ active, duration = 8000 }: { active: boolean; duration?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const petalsRef = useRef<Petal[]>([]);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) {
      cancelAnimationFrame(animRef.current);
      petalsRef.current = [];
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    startTimeRef.current = performance.now();
    petalsRef.current = Array.from({ length: 60 }, () => createPetal(canvas.width, canvas.height));

    let lastTime = performance.now();

    function drawPetal(petal: Petal) {
      ctx!.save();
      ctx!.translate(petal.x, petal.y);
      ctx!.rotate(petal.rotation);

      const gradient = ctx!.createRadialGradient(0, 0, 0, 0, 0, petal.size * 0.7);
      gradient.addColorStop(0, petal.color + "0.9)");
      gradient.addColorStop(0.7, petal.color + "0.4)");
      gradient.addColorStop(1, petal.color + "0)");

      ctx!.beginPath();
      ctx!.ellipse(0, 0, petal.size * 0.65, petal.size * 0.4, 0, 0, Math.PI * 2);
      ctx!.fillStyle = gradient;
      ctx!.globalAlpha = petal.opacity;
      ctx!.fill();

      ctx!.beginPath();
      ctx!.ellipse(petal.size * 0.05, -petal.size * 0.15, petal.size * 0.25, petal.size * 0.12, 0.3, 0, Math.PI * 2);
      ctx!.fillStyle = "rgba(255,255,255,0.2)";
      ctx!.fill();

      ctx!.restore();
    }

    function animate(now: number) {
      const elapsed = now - startTimeRef.current;
      if (duration > 0 && elapsed > duration) {
        const remaining = petalsRef.current.filter((p) => p.y < canvas!.height + 20);
        if (remaining.length === 0) {
          cancelAnimationFrame(animRef.current);
          return;
        }
      }

      const delta = Math.min(now - lastTime, 50);
      lastTime = now;

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      const isFadingOut = duration > 0 && elapsed > duration * 0.75;

      for (const petal of petalsRef.current) {
        petal.x += petal.speedX * (delta / 16) + Math.sin(now * 0.001 + petal.phase) * 0.4 * (delta / 16);
        petal.y += petal.speedY * (delta / 16);
        petal.rotation += petal.rotationSpeed * (delta / 16);

        if (isFadingOut) {
          petal.opacity = Math.max(0, petal.opacity - 0.008 * (delta / 16));
        }

        if (petal.y > canvas!.height + 20) {
          petal.y = -10;
          petal.x = Math.random() * canvas!.width;
        }
        if (petal.x > canvas!.width + 20) petal.x = -20;
        if (petal.x < -20) petal.x = canvas!.width + 20;

        drawPetal(petal);
      }

      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [active, duration]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10,
        pointerEvents: "none"
      }}
    />
  );
}
