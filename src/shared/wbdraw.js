// Menggambar satu anotasi whiteboard (koordinat 0..1 relatif terhadap halaman) ke canvas.
// Dipakai ruang meeting web dan penampil presentasi di aplikasi Android (halaman /m/pres).
export function drawShape(ctx, s, W, H, dpr = 1) {
  ctx.strokeStyle = ctx.fillStyle = s.c; ctx.lineWidth = s.w * dpr * (W / dpr / 900 + 0.4);
  ctx.lineCap = ctx.lineJoin = 'round';
  const P = s.p; const X = (i) => P[i] * W; const Y = (i) => P[i + 1] * H;
  if (s.k === 'pen') {
    ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (let i = 2; i < P.length; i += 2) ctx.lineTo(X(i), Y(i));
    if (P.length === 2) ctx.lineTo(X(0) + 0.1, Y(0));
    ctx.stroke();
  } else if (s.k === 'rect') { ctx.strokeRect(X(0), Y(0), X(2) - X(0), Y(2) - Y(0)); }
  else if (s.k === 'ellipse') {
    ctx.beginPath(); ctx.ellipse((X(0) + X(2)) / 2, (Y(0) + Y(2)) / 2, Math.abs(X(2) - X(0)) / 2, Math.abs(Y(2) - Y(0)) / 2, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (s.k === 'line' || s.k === 'arrow') {
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(2), Y(2)); ctx.stroke();
    if (s.k === 'arrow') {
      const a = Math.atan2(Y(2) - Y(0), X(2) - X(0)); const len = ctx.lineWidth * 4 + 8;
      ctx.beginPath(); ctx.moveTo(X(2), Y(2));
      ctx.lineTo(X(2) - len * Math.cos(a - 0.45), Y(2) - len * Math.sin(a - 0.45));
      ctx.lineTo(X(2) - len * Math.cos(a + 0.45), Y(2) - len * Math.sin(a + 0.45));
      ctx.closePath(); ctx.fill();
    }
  } else if (s.k === 'text') {
    ctx.font = `600 ${Math.max(8, s.fs * H)}px Inter, Segoe UI, Arial`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    s.tx.split('\n').forEach((line, i) => ctx.fillText(line, X(0), Y(0) + i * s.fs * H * 1.25));
  }
}
