# Foto Bareng

Photobooth online berdua: dua orang di tempat berbeda foto bareng lewat video, hasilnya satu strip.

- Buat ruangan, kirim link ke teman, jepret bareng (countdown sinkron).
- Layout strip 3, strip 4, grid 2×2. Filter, warna frame, hiasan, teks + tanggal.
- Simpan sebagai JPEG atau bagikan (Web Share, mis. ke WhatsApp).
- Mode solo kalau sendirian.

Video, suara, dan foto dikirim langsung antar perangkat (WebRTC lewat [PeerJS](https://peerjs.com)). Server publik PeerJS hanya dipakai untuk mempertemukan kedua perangkat (dan TURN relay bila jaringan ketat); foto tidak disimpan di server.

## Jalankan lokal

```bash
python3 -m http.server 8130
```

Buka `http://localhost:8130`. Tambahkan `?fake=1` untuk menguji tanpa kamera (pola warna sebagai pengganti kamera), misalnya dua tab: host dan tamu.

## File

- `index.html`: tampilan dan gaya
- `app.js`: kamera, koneksi PeerJS, protokol jepret sinkron
- `compose.js`: filter, layout, frame, ekspor
