import { useEffect, useRef } from 'react';
import { TrafficDataPoint } from '../types';

interface ClimateGraphProps {
  data: TrafficDataPoint[];
}

export default function ClimateGraph({ data }: ClimateGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (data.length < 2) {
        ctx.fillStyle = '#5a6478';
        ctx.font = '10px monospace';
        ctx.fillText('Collecting data...', 8, h / 2);
        return;
      }

      const padding = 4;
      const graphW = w - padding * 2;
      const graphH = h - padding * 2;

      const maxStations = Math.max(...data.map((d) => d.totalStations), 1);
      const maxTemp = Math.max(...data.map((d) => Math.abs(d.avgWaterTemp)), 1);
      const maxCO2 = Math.max(...data.map((d) => d.avgCO2), 1);

      // Grid lines
      ctx.strokeStyle = 'rgba(0, 255, 204, 0.05)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padding + (graphH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(w - padding, y);
        ctx.stroke();
      }

      // Stations area
      ctx.beginPath();
      ctx.moveTo(padding, h - padding);
      data.forEach((d, i) => {
        const x = padding + (graphW / (data.length - 1)) * i;
        const y = h - padding - (d.totalStations / maxStations) * graphH;
        ctx.lineTo(x, y);
      });
      ctx.lineTo(w - padding, h - padding);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, 'rgba(0, 255, 204, 0.3)');
      gradient.addColorStop(1, 'rgba(0, 255, 204, 0.0)');
      ctx.fillStyle = gradient;
      ctx.fill();

      // Stations line
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = padding + (graphW / (data.length - 1)) * i;
        const y = h - padding - (d.totalStations / maxStations) * graphH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#00ffcc';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Water temp line (scaled to its own max)
      const hasTemp = data.some((d) => d.avgWaterTemp !== 0);
      if (hasTemp) {
        ctx.beginPath();
        data.forEach((d, i) => {
          const x = padding + (graphW / (data.length - 1)) * i;
          const y = h - padding - (Math.abs(d.avgWaterTemp) / maxTemp) * graphH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // CO2 line (scaled to its own max)
      const hasCO2 = data.some((d) => d.avgCO2 > 0);
      if (hasCO2) {
        ctx.beginPath();
        data.forEach((d, i) => {
          const x = padding + (graphW / (data.length - 1)) * i;
          const y = h - padding - (d.avgCO2 / maxCO2) * graphH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#ff3366';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // New measurements bars
      const maxNew = Math.max(...data.map((d) => d.newMeasurements), 1);
      data.forEach((d, i) => {
        if (d.newMeasurements === 0) return;
        const x = padding + (graphW / (data.length - 1)) * i;
        const barH = (d.newMeasurements / maxNew) * graphH * 0.3;
        ctx.fillStyle = 'rgba(6, 182, 212, 0.6)';
        ctx.fillRect(x - 1, h - padding - barH, 2, barH);
      });

      // Current value label
      const latest = data[data.length - 1];
      ctx.fillStyle = '#00ffcc';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${latest.totalStations} stations`, w - padding, 12);
      ctx.textAlign = 'left';
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      draw();
    };

    resize();
    draw();
  }, [data]);

  return (
    <div className="bg-cyber-panel border-b border-cyber-border px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-cyber-text-dim">
          Climate Activity
        </span>
        <div className="flex items-center gap-3 text-[9px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-0.5 bg-cyber-accent" />
            <span className="text-cyber-text-dim">Stations</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-0.5 bg-ocean-warm" style={{ borderTop: '1px dashed' }} />
            <span className="text-cyber-text-dim">Avg Temp</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-0.5 bg-cyber-danger" style={{ borderTop: '1px dashed' }} />
            <span className="text-cyber-text-dim">CO2</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-ocean-cool" />
            <span className="text-cyber-text-dim">New</span>
          </span>
        </div>
      </div>
      <canvas ref={canvasRef} className="w-full" style={{ height: '60px' }} />
    </div>
  );
}
