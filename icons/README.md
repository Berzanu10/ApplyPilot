# ApplyPilot ikonları

| Dosya | Boyut | Kullanıldığı yer |
| --- | --- | --- |
| `icon-16.png` | 16×16 | Araç çubuğu (normal DPI), favicon |
| `icon-32.png` | 32×32 | Araç çubuğu (yüksek DPI), Windows görev çubuğu |
| `icon-48.png` | 48×48 | Eklenti yönetim sayfası, popup başlığı |
| `icon-128.png` | 128×128 | Chrome Web Store / Firefox Add-ons mağaza görseli |
| `icon.svg` | vektör | Kaynak tasarım |

`manifest.json` bu dosyalara hem `icons` hem de `action.default_icon` alanlarında başvurur.

Kendi ikonunu kullanmak istersen aynı isimlerle PNG dosyalarını bu klasöre koyman yeterli.
PNG'leri SVG geometrisinden yeniden üretmek için (Windows):

```powershell
powershell -ExecutionPolicy Bypass -File tools/generate-icons.ps1
```
