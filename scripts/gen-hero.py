# Membuat ilustrasi hero (SVG orisinal) — dijalankan sekali, hasil disimpan ke src/html/partials/hero-art.svg
tiles = [
 ("Sinta", "#3f6fa8", "#e9b48c", "#3a2418", "#2e6db4", "long"),
 ("Budi", "#d98a3a", "#c98b62", "#2b1d16", "#e7d5b8", "short"),
 ("Rina", "#6f8f62", "#f0c19a", "#b8742f", "#e57c2c", "long"),
 ("Dewi", "#3f9a96", "#d9a07a", "#2a1a12", "#d0482e", "long"),
 ("Andi", "#a2652f", "#b97c55", "#1f1510", "#e2b53b", "glasses"),
 ("Rizky", "#c9852f", "#c98d63", "#3a2416", "#e0a52d", "short"),
]
out = []
out.append('<svg class="hero-art" viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ilustrasi ruang meeting dengan enam peserta">')
out.append('''<defs>
<clipPath id="win"><rect x="0" y="0" width="900" height="500" rx="26"/></clipPath>
<linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6f9ce0"/><stop offset=".7" stop-color="#5560b8"/><stop offset="1" stop-color="#6e4bb6"/></linearGradient>
<symbol id="av" viewBox="0 0 190 190">
 <path d="M28 190c4-40 30-58 67-58s63 18 67 58z" style="fill:var(--shirt)"/>
 <rect x="84" y="112" width="22" height="26" rx="8" style="fill:var(--skin)"/>
 <path d="M60 64c0-26 16-40 35-40s35 14 35 40v34c0 22-16 36-35 36s-35-14-35-36z" style="fill:var(--skin)"/>
 <path d="M58 70c-2-30 14-48 37-48s40 16 37 48c-8-14-22-22-37-22s-29 8-37 22z" style="fill:var(--hair)"/>
 <path d="M58 70c-6 30-4 62 6 86l14-6c-8-20-10-48-8-72zM132 70c6 30 4 62-6 86l-14-6c8-20 10-48 8-72z" style="fill:var(--hair);display:var(--lh)"/>
 <circle cx="82" cy="86" r="4.5" fill="#2a1d17"/><circle cx="108" cy="86" r="4.5" fill="#2a1d17"/>
 <path d="M84 108c6 6 16 6 22 0" stroke="#7a3a2a" stroke-width="3" fill="none" stroke-linecap="round"/>
 <g style="display:var(--gl)" fill="none" stroke="#1d1d1d" stroke-width="3.5"><circle cx="82" cy="86" r="11"/><circle cx="108" cy="86" r="11"/><path d="M93 86h4"/></g>
 <path d="M54 84c0-34 18-52 41-52s41 18 41 52" stroke="#d9dde3" stroke-width="7" fill="none"/>
 <rect x="46" y="76" width="16" height="30" rx="7" fill="#e9ecf1"/><rect x="128" y="76" width="16" height="30" rx="7" fill="#e9ecf1"/>
</symbol></defs>''')
out.append('<g clip-path="url(#win)"><rect width="900" height="500" fill="#081a2e"/>')
out.append('<rect x="0" y="0" width="900" height="54" fill="#0a1e35"/>')
out.append('<text x="380" y="33" fill="#cfd8e6" font-family="Inter,Segoe UI,Arial" font-size="14" text-anchor="end">Ruang Kelas</text>')
out.append('<line x1="398" y1="18" x2="398" y2="38" stroke="#2b4466"/>')
out.append('<rect x="414" y="15" width="128" height="26" rx="13" fill="none" stroke="#3b587e"/><circle cx="432" cy="28" r="6" fill="none" stroke="#e2e8f0" stroke-width="2"/><circle cx="432" cy="28" r="2.5" fill="#e2e8f0"/>')
out.append('<text x="446" y="33" fill="#e2e8f0" font-family="Inter,Segoe UI,Arial" font-size="13">Mulai rekam</text>')
out.append('<circle cx="842" cy="28" r="13" fill="#1f8a73"/><path d="M836 33v-3M840 33v-6M844 33v-9M848 33v-12" stroke="#d5fff4" stroke-width="2" stroke-linecap="round"/>')
gx, gy, s = 165, 62, 190
for i, (name, bg, skin, hair, shirt, kind) in enumerate(tiles):
    x, y = gx + (i % 3) * s, gy + (i // 3) * s
    out.append(f'<rect x="{x}" y="{y}" width="{s}" height="{s}" fill="{bg}"/>')
    # dekorasi latar sederhana
    out.append(f'<circle cx="{x+150}" cy="{y+50}" r="22" fill="#ffffff" opacity=".10"/><rect x="{x+18}" y="{y+120}" width="34" height="24" rx="6" fill="#ffffff" opacity=".09"/>')
    hide = []
    if kind != "long": hide.append(".longhair")
    if kind != "glasses": hide.append(".glasses")
    lh = "inline" if kind == "long" else "none"; gl = "inline" if kind == "glasses" else "none"
    out.append(f'<g style="--skin:{skin};--hair:{hair};--shirt:{shirt};--lh:{lh};--gl:{gl}"><use href="#av" x="{x}" y="{y}" width="{s}" height="{s}"/></g>')
    out.append(f'<rect x="{x+4}" y="{y+s-20}" width="{len(name)*7+12}" height="16" rx="3" fill="#000" opacity=".35"/><text x="{x+10}" y="{y+s-8}" fill="#fff" font-family="Inter,Segoe UI,Arial" font-size="10.5">{name}</text>')
# badge logo tengah
out.append('<circle cx="450" cy="252" r="44" fill="#fff"/><circle cx="450" cy="252" r="38" fill="url(#lg)"/>')
out.append('<rect x="430" y="238" width="28" height="28" rx="7" fill="#fff"/><path d="M460 248l12-7v22l-12-7z" fill="#fff"/><rect x="438" y="246" width="12" height="12" rx="3" fill="#5a63b9"/>')
# kontrol bawah
out.append('<circle cx="44" cy="464" r="18" fill="#1f6fd1"/><path d="M44 456v16M36 464h16" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>')
for cx, kind in [(405, 'mic'), (450, 'cam'), (495, 'scr')]:
    fill = "#1f6fd1" if kind != 'scr' else "none"
    out.append(f'<circle cx="{cx}" cy="464" r="18" fill="{fill}" stroke="#cbd5e1" stroke-width="{0 if kind!="scr" else 1.5}"/>')
out.append('<rect x="401" y="455" width="8" height="12" rx="4" fill="#fff"/><path d="M398 464a7 7 0 0 0 14 0" stroke="#fff" stroke-width="1.8" fill="none"/>')
out.append('<rect x="442" y="458" width="11" height="11" rx="2" fill="#fff"/><path d="M454 461l5-3v11l-5-3z" fill="#fff"/>')
out.append('<rect x="487" y="457" width="16" height="12" rx="2" stroke="#e2e8f0" stroke-width="1.6" fill="none"/>')
out.append('<circle cx="856" cy="464" r="18" fill="none" stroke="#cbd5e1" stroke-width="1.5"/><path d="M851 470v-9a2 2 0 0 1 4 0v5m0-7a2 2 0 0 1 4 0v7m-8 2c0 3 2 5 5 5s5-2 5-6v-6" stroke="#e2e8f0" stroke-width="1.6" fill="none" stroke-linecap="round"/>')
out.append('</g></svg>')
svg = "\n".join(out)
open("src/html/partials/hero-art.svg", "w").write(svg)
print(len(svg))
