# Dock Savunması — Faz 0 prototip

Matrix Revolutions’daki Dock savunmasından esinlenen, tarayıcıda çalışan 3B savunma nişancı oyunu.
Three.js ile yazıldı; dahili ekran kartlarında çalışacak şekilde hafif tutuldu.

## Çalıştırma

`baslat.bat` dosyasına çift tıkla. Tarayıcı `http://localhost:8080` adresinde açılır.
Ya da bu klasörde:

```
python devserver.py 8080
```

(`devserver.py` dosyaları önbelleksiz sunar; yaptığın her değişiklik tarayıcıya hemen yansır.)

**Yayındaki sürüm:** https://onyuss.github.io/dock-savunmasi/

Three.js `vendor/` klasöründe olduğu için internet gerekmez.

## Uygulama olarak yükleme (PWA)

- **Windows:** Chrome / Edge’de açılış ekranındaki “UYGULAMA OLARAK YÜKLE” düğmesi ya da adres çubuğundaki yükle simgesi.
- **Android:** Chrome menüsü → “Uygulamayı yükle” / “Ana ekrana ekle”.
- **iPhone / iPad:** Safari → Paylaş → “Ana Ekrana Ekle”.

Telefonda yükleyebilmek için oyunun **HTTPS** bir adreste yayında olması gerekir (ör. GitHub Pages).
`localhost` dışındaki `http://` adreslerde yükleme ve çevrimdışı mod çalışmaz.
Yüklendikten sonra oyun çevrimdışı da açılır (`sw.js` dosyaları önbelleğe alır).

Masaüstünde dokunmatik arayüzü denemek için: `http://localhost:8080/?touch`

## Kontroller

| Tuş | İşlev |
| --- | --- |
| WASD | Hareket |
| Shift | Koş (piyade) |
| Space | Zıpla (piyade) |
| Fare / Sol tık | Nişan / Ateş |
| Sağ tık (basılı) | Dürbün / yakınlaştırma |
| R | Şarjör değiştir (piyade) |
| E | En yakın APU’ya ya da kuleye bin, in |
| V | APU’da iç (kokpit) / dış kamera |
| B | Parlama (bloom) efektini aç / kapat |
| Esc | Duraklat |

## Faz 0’da olanlar

- Kubbeli gri kutu Dock: 6 APU platformu, 4 kule, siperler, cephane deposu, gemi rıhtımları, kapı
- Piyade: birinci şahıs hareket, tüfek, can yenilenmesi, ölünce depoda yeniden doğma
- APU: binme / inme, ağır yürüyüş ve ekran sarsıntısı, kokpit ve dış kamera, ikiz toplar, ısınma ve kilitlenme, sol / sağ cephane
- Kule: ikiz uçaksavar, hava patlamalı atış
- Pilotsuz APU ve kuleler yapay zekâ ile en yakın düşmana ateş eder
- Sürü: tavandaki 3 delme noktasından dalan, hedef seçip saldıran 320’ye kadar düşman
- Dalgalar, hazırlık süresi, HUD, sesler (dosyasız, WebAudio ile üretiliyor)
- FPS düşerse çözünürlük otomatik azalır

## Dosyalar

- `src/main.js` — görüntüleyici, oyun durumu, dalgalar, HUD, ana döngü
- `src/world.js` — Dock haritası ve çarpışma
- `src/player.js` — piyade
- `src/apu.js` — APU modeli, kontrolü ve yapay zekâsı
- `src/turret.js` — savunma kulesi
- `src/enemies.js` — makine sürüsü
- `src/effects.js` — parçacıklar, mermi izleri, namlu alevleri
- `src/textures.js` — kodla üretilen PBR metal dokular (renk, kabartma, pürüzlülük)
- `src/audio.js` — ses efektleri
- `src/input.js` — klavye ve fare

Geliştirme için `http://localhost:8080/?test` adresi fare kilidi olmadan çalışır ve `window.game` nesnesini açar.

## Dokunmatik kontroller

Sol başparmak: sanal joystick (sonuna kadar itince koşar) · Sağ yarıda kaydır: nişan ·
ATEŞ (basılı tut) · DÜRBÜN (aç / kapat) · BİN · KAM · ZIPLA · ŞARJÖR · II (duraklat)

## Kaynaklar ve lisanslar

- Dokular ve HDRI: [Poly Haven](https://polyhaven.com) — CC0 (metal_plate, rusty_metal_02, rusty_metal_sheet, green_metal_rust, industrial_pipe_and_valve_01)
- [three.js](https://threejs.org) r170 — MIT lisansı (`vendor/three/LICENSE`)

## Co-op notu

Oyun mantığı girişleri tek bir `Input` nesnesinden okuyor ve her gövde (piyade, APU, kule) aynı arayüzü kullanıyor.
Co-op aşamasında bir oyuncu sunucu olacak, diğerlerinin girişleri WebSocket üzerinden aynı yapıya aktarılacak.
