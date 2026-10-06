# Ăn Dặm Radar

Công cụ web miễn phí giúp shop đồ ăn dặm **tìm sản phẩm mục tiêu và nghiên cứu thị trường**. Nhập một từ khoá, app sẽ tìm song song trên search engine, sàn TMĐT, chuỗi mẹ & bé Việt Nam, shop nước ngoài và cơ sở dữ liệu thực phẩm. Kết quả được gộp vào một bảng gồm ảnh, giá quy đổi VNĐ, giá/100g, quốc gia, nguồn, đánh giá/lượt bán, thành phần, độ tuổi, cách dùng và cách bảo quản.

## Chạy app

Yêu cầu **Node.js 22.13 trở lên** (app dùng SQLite tích hợp sẵn của Node). Chạy được trên Windows, macOS và Linux.

```bash
npm install
```

```bash
npm start
```

Mở trình duyệt tại **http://localhost:3000**. Không cần tài khoản hay API key nào.

### Windows

Nhấp đúp file `chay-app.bat`. File này tự cài thư viện ở lần đầu, chạy app và mở trình duyệt khi app sẵn sàng. Nếu app đã chạy sẵn, nó chỉ mở trình duyệt. Đóng cửa sổ đen (hoặc bấm Ctrl+C) để tắt app.

### macOS

1. Cài Node.js (một lần): tải bản **LTS** (file `.pkg`) tại https://nodejs.org, hoặc nếu có Homebrew thì chạy lệnh dưới đây trong Terminal.

   ```bash
   brew install node
   ```

2. Tải dự án về (một lần):

   ```bash
   git clone https://github.com/billy7d/crawl-data.git
   ```

3. Trong Finder, mở thư mục `crawl-data` và **nhấp đúp `chay-app.command`**. Terminal mở ra, lần đầu tự cài thư viện (~1 phút), chạy app và mở trình duyệt. Đóng cửa sổ Terminal (hoặc Ctrl+C) để tắt app.

4. (Tuỳ chọn) Nhấp đúp `tao-app-macos.command` để tạo **Ăn Dặm Radar.app** trong thư mục Ứng dụng của bạn — mở bằng Launchpad/Spotlight hoặc kéo vào Dock như app bình thường.

**Nếu macOS chặn mở file** ("không thể mở vì không xác định được nhà phát triển" — thường gặp khi tải ZIP thay vì `git clone`): nhấp chuột phải vào file → **Mở** → **Mở**. Nếu báo không có quyền chạy, mở Terminal trong thư mục dự án và chạy lệnh dưới đây một lần.

```bash
chmod +x chay-app.command tao-app-macos.command
```

**Khóa API và dữ liệu** (`.env`, thư mục `data/`) chỉ nằm trên máy đang chạy, không có trên GitHub. Trên Mac mới, nhập lại khóa trong ⚙ Cài đặt nguồn — hoặc chép file `.env` (và `data/` nếu muốn giữ lịch sử, danh sách theo dõi) từ máy cũ sang thư mục dự án.

Cập nhật bản mới (trong thư mục dự án):

```bash
git pull
```

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| **Tìm kiếm nhanh** | Gọi song song mọi nguồn. Kết quả hiện dần qua streaming (nguồn đầu tiên thường sau ~0,5s). Gợi ý từ khoá khi gõ, phím tắt `/`. Tìm lại cùng từ khoá trong 6 giờ thì lấy từ cache, gần như tức thì. |
| **Dừng / tìm mới** | Nút **Dừng** ngắt phiên đang chạy (giữ kết quả đã có, máy chủ huỷ các yêu cầu còn lại); nút **Tìm mới** luôn bấm được và thay phiên cũ. Tab Cơ hội nhập khẩu có **Dừng phân tích**. |
| **Độ phủ tìm kiếm** | ⚙ Cài đặt → Tiết kiệm / Cân bằng / Sâu: số trang Google Shopping và cỡ nhóm trang bán khi tìm qua Serper (sâu hơn = nhiều nguồn hơn, tốn nhiều lượt Serper hơn). Tên thương hiệu và từ như "puffs", "bio" không bị dịch khi tìm ở nước ngoài. |
| **Đa thị trường** | 14 thị trường: VN, Mỹ, Anh, Úc, Đức, Pháp, Nhật, Hàn, Trung, Singapore, Thái, Malaysia, Philippines, Indonesia. Từ khoá được **tự dịch** sang ngôn ngữ từng nước, có bảng thuật ngữ ăn dặm riêng ("bánh ăn dặm" → "baby snacks", "赤ちゃんのおやつ"). Bản dịch sửa được ngay trên giao diện. |
| **Bảng tổng hợp** | Ảnh, tên, thương hiệu, giá gốc + quy đổi VNĐ (tỷ giá cập nhật tự động), giá niêm yết/giảm giá, **giá/100g**, quốc gia, xuất xứ, nguồn/người bán, đánh giá, lượt bán. Thông tin chính gồm thành phần, độ tuổi, bảo quản, cách dùng. Nhãn tự nhận diện: hữu cơ, không đường, không muối, không gluten, DHA, sắt, probiotic… |
| **Lọc & sắp xếp** | Theo nguồn, quốc gia, loại SP, độ tuổi, khoảng giá, nhãn, **loại trừ chất gây dị ứng**. Có thể ẩn quảng cáo, ẩn kết quả ít liên quan, ẩn dụng cụ/phụ kiện. Sắp xếp theo giá, giá/100g, bán chạy, đánh giá, giảm giá. Xem dạng bảng hoặc lưới. |
| **Chi tiết sản phẩm** | Tự đọc trang sản phẩm để lấy thành phần, cách dùng, bảo quản, xuất xứ, HSD, Nutri-Score. Dịch sang tiếng Việt một chạm. Nút "Tìm ở thị trường khác" để so giá quốc tế. |
| **Tổng quan thị trường** | Chỉ số chính, nhận định tự động (khoảng giá phổ biến, phân khúc bình dân/trung cấp/cao cấp, thương hiệu dẫn đầu, chênh lệch giá VN với nước ngoài). Biểu đồ phân bố giá, giá trung vị theo quốc gia, thương hiệu, loại SP, độ tuổi, nhãn. Bảng **bán chạy nhất** và bảng **cơ hội nhập khẩu** (so giá/100g cùng thương hiệu giữa VN và nước rẻ nhất). |
| **Cơ hội nhập khẩu** | Đối chiếu từng sản phẩm tìm thấy ở nước ngoài với các kênh Việt Nam (Con Cưng, Kids Plaza, Bibomart, AVAKids, Tiki, Lazada, Shopee…). App khớp sản phẩm theo mã vạch, thương hiệu và vị/nguyên liệu (bảng thuật ngữ song ngữ), rồi đọc trang bán để tìm **nhà nhập khẩu/phân phối**. Phân loại: **Chưa có tại VN** · **Hãng có, SP chưa** (kèm nhà phân phối của hãng) · **Có bán, chưa đủ chuẩn NKCN** · **Đã NKCN** (có ở ≥2 chuỗi mẹ & bé lớn **và** có tên nhà nhập khẩu). Mỗi kết luận có lý do, link bằng chứng và nhãn "chưa chắc" khi kênh chính (Tiki/Lazada…) không kiểm tra được. Nút **Âu–Mỹ–Úc / Tất cả** chọn nhanh thị trường gốc. Chạy 2 lượt: **lượt nhanh** trả kết luận cho từng SP sau vài giây từ các nguồn phản hồi nhanh (Con Cưng, Kids Plaza, Tiki, Google), rồi **lượt bổ sung** tự cập nhật dòng khi nguồn chậm (Lazada qua proxy, trang chi tiết) trả về — nhãn "đang bổ sung" cho biết dòng nào còn chờ. |
| **Bán chạy theo nước** | Nút **Lấy bán chạy theo nước** (tab Cơ hội nhập khẩu) lấy top ~50 nhóm *Thực phẩm → Đồ ăn cho bé* của Amazon Best Sellers tại các thị trường nước ngoài đang chọn (Mỹ, Anh, Đức, Pháp, Ý, Tây Ban Nha, Hà Lan, Canada, Úc, Nhật), bỏ sữa công thức và đồ uống bổ sung. Top 10 mỗi nước được đưa vào phân tích NKCN cùng kết quả tìm kiếm; thứ hạng cộng vào điểm cơ hội và hiện thành nhãn "#hạng bán chạy · nước". Không cần khóa API; danh sách lưu 12 giờ. |
| **Điểm cơ hội** | Mỗi sản phẩm nước ngoài có điểm 0–100 = nhu cầu (đánh giá & sao ở nước ngoài, số nước/nhà bán, lượt bán & tốc độ bán hàng xách tay tại VN, số gợi ý tìm kiếm tiếng Việt có ngữ cảnh ăn dặm cho thương hiệu, chênh lệch giá VN–gốc) × hệ số nhóm (Chưa có 1 · Hãng có SP chưa 0,9 · Chưa đủ chuẩn 0,8 · Đã NKCN 0,2). Nút **Vì sao?** liệt kê từng thành phần điểm. Kèm **Top cơ hội**, **Thương hiệu tiềm năng** và **danh bạ nhà nhập khẩu** lưu lâu dài (tìm kiếm được). |
| **Lịch sử lượt bán** | Mỗi tin bán tại VN gặp khi tìm kiếm hoặc phân tích được chụp lại (lượt bán, số đánh giá, giá; tối đa 1 lần/12 giờ) vào `data/sales.db` (SQLite tích hợp của Node). Bấm **☆ Theo dõi** ở tab Cơ hội nhập khẩu: app tự kiểm tra lại mỗi 24 giờ khi đang chạy (chỉnh trong ⚙ Cài đặt), hiện **tốc độ bán/tuần**, biểu đồ và **diễn biến kết luận** (vd. Chưa có → Đã NKCN khi có nhà phân phối mới). Chuỗi không công bố lượt bán thì dùng tốc độ tăng đánh giá. |
| **Thành phần & bảo quản** | Đọc từ trang sản phẩm (JSON nhúng, mô tả, Hỏi–Đáp), API riêng của từng shop, tra mã vạch trên Open Food Facts, hoặc mượn từ cùng sản phẩm ở nguồn khác (ghi rõ "theo nguồn X"). Tự lấy cho mọi dòng đang hiển thị. |
| **So sánh** | Chọn tối đa 6 sản phẩm để so cạnh nhau. Ô tốt nhất được tô xanh. |
| **Theo dõi** | Lưu SP tiềm năng kèm trạng thái (nghiên cứu → liên hệ NCC → đặt mẫu → nhập hàng), nhà cung cấp, giá nhập, giá bán dự kiến. **Biên lợi nhuận** được tính tự động. Có nút cập nhật giá và biểu đồ lịch sử giá. |
| **Từ khoá** | Gợi ý tìm kiếm thật của người mua (Google + DuckDuckGo) cho từ gốc và các biến thể ("…cho bé", "…loại nào tốt", "…giá", "…nhập khẩu"…), thống kê từ đi kèm phổ biến. |
| **Xuất dữ liệu** | CSV mở bằng Excel (đúng tiếng Việt), copy dán thẳng vào Google Sheets, JSON. |
| **Mở nhanh** | Một chạm mở cùng từ khoá (đã dịch) trên Google, Google Shopping, Shopee, TikTok, Google Trends, Amazon, iHerb, Alibaba (tìm NCC sỉ), Rakuten, Coupang, Taobao. |

## Nguồn dữ liệu

| Nguồn | Thị trường | Cách lấy | Ghi chú |
|---|---|---|---|
| Tiki | VN | API công khai | Có lượt bán, xuất xứ, thông số chi tiết |
| Lazada | VN, TH, SG, MY, PH, ID | API tìm kiếm | Có lượt bán, đánh giá |
| Con Cưng, Kids Plaza | VN | Trang tìm kiếm | Chuỗi mẹ & bé lớn |
| Amazon | US, UK, DE, FR, JP, AU, SG | Trang tìm kiếm | DE/AU/JP thường ổn định; US/UK hay bị captcha |
| Target | US | API redsky | |
| Tesco, Sainsbury's, Waitrose, Morrisons | UK | API / dữ liệu nhúng | Tesco đôi khi chặn (403) |
| Woolworths | AU | API | |
| dm-drogerie | DE | API | |
| FairPrice | SG | API | |
| Monoprix | FR | Trang tìm kiếm | Siêu thị Pháp, đọc trực tiếp |
| Carrefour | FR | Qua `SCRAPE_PROXY` (IP Pháp) | Đọc dữ liệu gốc của trang: giá, giá/kg, **EAN**, quy cách, danh mục, ảnh gốc. Chặn IP ngoài Pháp nên đi qua proxy với `country_code=fr` (1 credit/lần, tự thử gói premium nếu bị chặn) |
| Auchan | FR | Trang tìm kiếm (trực tiếp) | Tên, ảnh, link, điểm sao. Auchan chỉ hiện giá sau khi chọn cửa hàng nên không có giá |
| Chronodrive | FR | Qua `SCRAPE_PROXY` | Tên, giá, ảnh, link |
| E.Leclerc | FR | Trang tìm kiếm | Tên, giá, giá/kg, thương hiệu, **EAN** |
| Shop Apotheke | DE | Trang tìm kiếm | Nhà thuốc online lớn nhất Đức (HiPP, Alete, Bebivita…) |
| Farmaè, Farmacia Igea, Amica Farmacia | IT | Trang tìm kiếm | Nhà thuốc online Ý — bán phần lớn đồ ăn dặm (Plasmon, Mellin, HiPP) |
| Prenatal | IT | API tìm kiếm công khai (Meilisearch) | Giá, **tổng lượt bán**, điểm sao, thương hiệu, EAN, mô tả. Khóa tìm kiếm đọc từ trang (qua proxy 1 lần, lưu 30 ngày) |
| eFarma | IT | API tìm kiếm công khai (Algolia) | Giá, **EAN**, **thành phần**, lượt bán, thương hiệu. Khóa đọc từ trang giống Prenatal |
| Asda | GB | API tìm kiếm công khai (Algolia) | Giá, giá/kg, điểm sao, quy cách, nhãn dinh dưỡng. Khóa đọc từ cấu hình công khai của trang (qua proxy 1 lần, lưu 30 ngày) |
| Boots | GB | API tìm kiếm công khai (Algolia) | Giá, **UPC**, điểm sao, số đánh giá, độ tuổi phù hợp. Khóa đọc từ trang như Asda |
| REWE | DE | Qua `SCRAPE_PROXY` (IP Đức) | Tên, ảnh, link; **không có giá** (REWE chỉ hiện giá sau khi chọn cửa hàng) |
| Shoppers Drug Mart | CA | Qua `SCRAPE_PROXY` (IP Canada) | Dữ liệu Next.js của trang: giá, thương hiệu, sao, khuyến mãi |
| Lotte ON | KR | Qua `SCRAPE_PROXY` (IP Hàn) | Dữ liệu sản phẩm nhúng trong trang: giá, giảm giá, sao |
| Aldi UK | GB | Trang tìm kiếm | Thương hiệu + tên + quy cách, giá, giá/100g |
| Yahoo!ショッピング | JP | Qua `SCRAPE_PROXY` (IP Nhật) | |
| Rakuten | JP | Trang tìm kiếm | 45 SP/trang: giá, điểm sao, số đánh giá, tên shop |
| SSG.COM | KR | Qua `SCRAPE_PROXY` (IP Hàn) | Sàn của Shinsegae/E-mart |
| Kurly, 11번가 | KR | API công khai của chính trang (không cần khóa) | Kurly: giá, giảm giá, số đánh giá. 11st: giá, **lượt bán**, điểm hài lòng, shop chính hãng |
| Well.ca | CA | Trang tìm kiếm | |
| Walmart Canada, Loblaws | CA | Qua `SCRAPE_PROXY` (IP Canada) | |
| Kroger | US | Qua `SCRAPE_PROXY` (IP Mỹ) | Tên, giá, quy cách, **mã UPC** |
| Bing Shopping | US, UK, AU, DE, FR | Trang tìm kiếm | Giá từ nhiều shop |
| **Shop khác (qua search engine)** | Mọi thị trường | Tìm `site:` qua Serper (theo nhóm nhỏ trang bán), dự phòng DuckDuckGo/Bing | 10–14 trang bán mỗi thị trường: siêu thị, nhà thuốc online, cửa hàng mẹ & bé (vd. Pháp: Carrefour, Auchan, Monoprix, Leclerc, Intermarché, Franprix, Chronodrive, Houra, Cdiscount, Aubert, Newpharma, Pharma GDD, Cocooncenter, Amazon). Lấy link và giá trong trích đoạn |
| Bing, DuckDuckGo | Mọi thị trường | Trang kết quả | Bài viết, review, trang hãng |
| Open Food Facts (+ Open Prices) | Toàn cầu | API mở | Thành phần, dị ứng, Nutri-Score, các nước đang bán |
| Google, Google Shopping | Mọi thị trường | Cần `SERPER_API_KEY` | **Khuyên dùng:** Google Shopping gom giá từ gần như mọi shop |
| SearXNG | Mọi thị trường | Cần `SEARXNG_URL` | Meta-search tự host: Google + Bing + DDG + Brave + Qwant |
| Brave Search | Mọi thị trường | Cần `BRAVE_API_KEY` | |
| **Naver Shopping** | KR | API chính thức, cần `NAVER_CLIENT_ID` + `NAVER_CLIENT_SECRET` | Miễn phí 25.000 lượt/ngày. Máy so sánh giá lớn nhất Hàn Quốc: mỗi kết quả là giá thấp nhất trong nhiều shop (Gmarket, 11st, Coupang, SSG, Smart Store…), kèm giá cao nhất, thương hiệu, nhà sản xuất, danh mục. Không có lượt bán/đánh giá. "Độ phủ sâu" đọc 200 kết quả thay vì 100 |
| Walmart, iHerb, Coles, Coupang (trực tiếp) | | Cần `SCRAPE_PROXY` | Đọc qua proxy chống chặn bot. Chemist Warehouse, eBay, Shopee đã bỏ (qua proxy thường chỉ nhận trang chặn; Shopee cần gói ultra premium). Asda và Boots đọc qua API tìm kiếm riêng (xem bảng trên) — vẫn có qua "Shop khác" |

### Về các trang chặn bot (Walmart, Tesco, Amazon US…)

Các chuỗi bán lẻ lớn dùng hệ thống chống bot (Akamai, PerimeterX, Cloudflare). Khi cào miễn phí từ một IP thường, bạn sẽ gặp:

- **Có trang cào được trực tiếp.** App xử lý sẵn.
- **Có trang chặn.** App tự chuyển sang tìm `site:` qua search engine, vẫn có link, tên và thường có cả giá trong trích đoạn.
- **Search engine cũng giới hạn** khi bị gọi quá dày (captcha hoặc trả kết quả không liên quan). App tự giãn tốc độ gọi, "tạm nghỉ" vài phút với nguồn bị chặn, tự lọc bỏ kết quả rác và không lưu chúng vào cache. Trạng thái từng nguồn hiện ở thanh tiến trình: chấm xanh là ổn, vàng là giới hạn, đỏ là lỗi. Di chuột lên để xem lý do.

Để lấy dữ liệu **ổn định từ mọi shop**, bấm **biểu tượng bánh răng → Cài đặt nguồn** trong app, dán khóa, bấm **Kiểm tra** rồi **Lưu**. Khóa được ghi vào file `.env` và áp dụng ngay, không cần khởi động lại. Có thể tự sửa `.env` (mẫu ở `.env.example`) nếu muốn. Các tuỳ chọn (đều có gói miễn phí):

1. **`SERPER_API_KEY`** (https://serper.dev, 2.500 lượt miễn phí): bật Google Search và Google Shopping, giá từ Walmart, Tesco, Target, Boots, Coles… theo từng nước.
2. **`SEARXNG_URL`**: SearXNG tự host bằng Docker, miễn phí, không giới hạn:
   ```bash
   docker compose -f searxng/docker-compose.yml up -d
   ```
   rồi đặt `SEARXNG_URL=http://localhost:8888`.
3. **`SCRAPE_PROXY`** (ScraperAPI, ScrapingBee, ZenRows…): mở khoá cào trực tiếp Walmart, iHerb, Coles, Carrefour, Kroger… (Shopee không đọc được ổn định, xem mục Tình trạng nguồn dữ liệu) và tự dùng làm phương án dự phòng khi Amazon/Tesco chặn. Trong Cài đặt nguồn chỉ cần chọn nhà cung cấp và dán API key.

Cài đặt chỉ chỉnh được từ chính máy chạy app. Nếu đưa app lên máy chủ, đặt thêm `SETTINGS_TOKEN` trong `.env` để quản trị từ xa.

## Tình trạng nguồn dữ liệu (kiểm tra ngày 06/10/2026)

Trang web đổi giao diện và hệ thống chống bot liên tục, nên bảng dưới là ảnh chụp tại thời điểm kiểm tra, không phải cam kết. Cách kiểm tra lại từng nguồn: `npm run test:sources -- "từ khóa"`.

Các nguồn dưới đây được thử theo ba cách: truy cập thẳng, qua proxy IP đúng nước (`SCRAPE_PROXY` + `country_code`), và dò API mà chính trang dùng để hiện kết quả. Ứng dụng **không** giải captcha và **không** giả dạng trình duyệt hay người dùng để vượt hệ thống chống bot; trang nào chặn bằng cách đó thì chỉ lấy được dữ liệu gián tiếp (xem cột "Vẫn có dữ liệu qua").

### Đang chạy tốt, không cần khóa

| Thị trường | Nguồn |
|---|---|
| VN | Con Cưng, Kids Plaza, Tiki (khi IP không bị chặn) |
| Pháp | Monoprix, Auchan (không có giá), E.Leclerc |
| Đức | dm-drogerie, Shop Apotheke |
| Ý | Farmaè, Farmacia Igea, Amica Farmacia |
| Anh | Tesco, Sainsbury's, Waitrose, Morrisons, Aldi UK |
| Nhật | Rakuten |
| Hàn | Kurly, 11번가 |
| Canada | Well.ca |
| Mỹ | Target |
| Úc / Singapore | Woolworths, FairPrice |
| Toàn cầu | Open Food Facts, Bing, DuckDuckGo |

### Chỉ chạy khi có `SCRAPE_PROXY` còn lượt

Lazada, Carrefour (FR), Chronodrive (FR), REWE (DE), Yahoo!ショッピング (JP), SSG.COM, Lotte ON (KR), Walmart Canada, Loblaws, Shoppers Drug Mart (CA), Kroger (US), Walmart, iHerb, Coles, Coupang.

**Prenatal, eFarma (IT), Asda, Boots (UK)** dùng proxy đúng 1 lần để đọc khóa tìm kiếm công khai từ trang, rồi lưu 30 ngày; sau đó tìm trực tiếp, không tốn credit. Khi dịch vụ từ chối khóa (đổi khóa), app tự đọc lại. Amazon thường đọc thẳng được, bị chặn thì tự chuyển qua proxy.

**Proxy hết lượt:** gói miễn phí của ScraperAPI chỉ có 5.000 credit/tháng; Lazada dùng gói premium nên tốn khoảng 10 credit mỗi lần. Khi nhà cung cấp báo hết lượt, app tự ngừng gọi proxy 6 giờ, các nguồn trên báo lỗi ngay kèm lý do (thanh trạng thái và ⚙ Cài đặt có cảnh báo), còn các nguồn không cần proxy vẫn chạy. Lưu khóa mới trong ⚙ Cài đặt thì app thử lại ngay. Tại thời điểm kiểm tra, gói của người phát triển đã hết lượt tháng 10 (được cấp lại ngày 03/11).

### Chặn bot — chưa truy cập được

Các trang này trả mã 403/202, captcha hoặc trang thử thách khi truy cập thẳng, và vẫn lỗi hoặc quá thời gian khi qua proxy IP đúng nước. Chúng dùng dịch vụ chống bot theo hành vi (DataDome, Akamai, PerimeterX, Cloudflare…), không phải chặn theo vùng.

| Thị trường | Trang | Vẫn có dữ liệu qua |
|---|---|---|
| Pháp | Cora, Intermarché, Franprix | Google Shopping, "Shop khác" |
| Đức | Kaufland | Google Shopping, "Shop khác", Amazon |
| Ý | Carrefour.it, Iper, Farmaciauno (Cloudflare "Attention Required") | Google Shopping, "Shop khác", Amazon |
| Anh | Holland & Barrett, Ocado, Iceland ("Access Denied" cả khi mở bằng trình duyệt thật) | Google Shopping, "Shop khác" |
| Hàn | Gmarket, Auction (Naver Shopping có phủ các shop này khi đã cấu hình khóa Naver) | Coupang, SSG, 11번가, Kurly, Naver Shopping |
| Canada | Voilà | Google Shopping, "Shop khác" |
| Mỹ | Walgreens, Thrive Market (CloudFront báo lỗi), CVS (chỉ cho IP trong nước Mỹ) | Google Shopping, "Shop khác" |
| Việt Nam | Shopee (cần gói "ultra premium" của ScraperAPI, rất tốn credit) | Google Shopping, "Shop khác" (có giá, không có lượt bán) |

### Tải được qua proxy nhưng chưa có bộ đọc dữ liệu

Các trang này tải được qua proxy nhưng sản phẩm không có trong HTML, hoặc chưa kiểm tra được cấu trúc. Đã thử mở bằng trình duyệt thật (có chạy JavaScript) để tìm API của trang; chỉ những trang dùng dịch vụ tìm kiếm công khai (Algolia, Meilisearch) mới đọc được, như Asda, Boots, Prenatal, eFarma.

| Thị trường | Trang | Ghi chú |
|---|---|---|
| Đức | windeln.de | Tìm kiếm trả về trang thương hiệu/danh mục, không phải kết quả |
| Đức | DocMorris | Đọc được nhưng trả nhiều sản phẩm không liên quan (thuốc) nên đã tắt |
| Pháp | Super U, Newpharma | Tải được qua proxy nhưng chưa phân tích được cấu trúc (HTML chưa được lưu lại để kiểm tra) |

Proxy có dựng JavaScript (ScraperAPI `render=true`, truyền được qua `proxyExtra`) tốn khoảng 10 credit mỗi lần và không vượt được chống bot, nên chưa dùng.

### Chưa kiểm tra được rõ

Kết quả lần thử không kết luận được (lỗi 404 do đoán sai địa chỉ tìm kiếm, hoặc lỗi 429 do thử quá nhiều yêu cầu cùng lúc so với giới hạn luồng của gói proxy). Cần thử lại: babymarkt, Rossmann (trả trang rỗng 3KB), Auction (KR), EasyCoop (IT), Co-op (UK), Metro, London Drugs (CA).

### Có vấn đề khác — chưa đọc được

| Trang | Vấn đề |
|---|---|
| Esselunga, Conad (IT) | Chỉ hiện sản phẩm sau khi chọn địa chỉ giao hàng; Conad còn có bộ phát hiện bot |
| REWE (DE) | Đã có bộ đọc nhưng không có giá: REWE chỉ hiện giá sau khi chọn cửa hàng |
| Auchan (FR) | Đọc được tên, ảnh, link, sao nhưng không có giá (giá chỉ hiện sau khi chọn cửa hàng) |
| Müller (DE) | Tìm theo thương hiệu bị chuyển sang trang thương hiệu chỉ có banner |
| Otto (DE) | Kết quả lẫn nhiều sản phẩm không liên quan (máy hút sữa…) nên đã tắt |
| Shopee (VN) | Xem phần chặn bot ở trên. Hướng hợp lệ: Shopee Affiliate Open API (miễn phí, cần đăng ký, chưa tích hợp) |

### Hướng hợp lệ để lấy thêm dữ liệu

- **API chính thức miễn phí (bạn tự đăng ký khóa):** Naver Shopping API (đã tích hợp, xem bảng nguồn), Shopee Affiliate Open API, Rakuten Ichiba API, Yahoo Shopping Japan API, Kroger API.
- **Nâng gói proxy** để có nhiều lượt và nhiều luồng hơn (đặt `PROXY_CONCURRENCY` trong `.env`).
- **Tiện ích Chrome** đọc trang ngay trong trình duyệt của bạn khi bạn mở trang đó (chưa làm).

## Nhật ký cập nhật

**06/10/2026**
- Tích hợp **Naver Shopping API** (Hàn Quốc): thẻ cài đặt riêng với ô Client ID/Secret, nút Kiểm tra khóa, lưu vào `.env` (ẩn khóa khi hiển thị).
- Thêm **Asda** và **Boots** (Anh) qua API Algolia công khai của chính trang (tìm ra bằng cách mở trang trong trình duyệt thật): Asda có giá, sao, quy cách; Boots có UPC, giá, đánh giá.
- Bộ đọc mới cho các trang tải được qua proxy: **Prenatal** (Meilisearch) và **eFarma** (Algolia) qua API tìm kiếm công khai của chính trang (có giá, EAN, lượt bán, thành phần), **Shoppers Drug Mart** (dữ liệu Next.js), **Lotte ON** (JSON nhúng), **REWE** (thẻ sản phẩm, không giá). Viết và kiểm tra trên HTML đã lưu vì proxy đã hết lượt.
- Đọc trực tiếp **Kurly**, **11번가** (API công khai của chính trang), **E.Leclerc** (HTML).
- Phát hiện proxy hết lượt: tạm ngừng gọi proxy, báo rõ trên thanh trạng thái và Cài đặt.

**05/10/2026**
- Thêm 12 nguồn đọc trực tiếp cho Đức, Ý, Anh, Nhật, Hàn, Canada, Mỹ (Shop Apotheke, Farmaè, Farmacia Igea, Amica Farmacia, Aldi UK, Yahoo!ショッピング, SSG, Well.ca, Walmart Canada, Loblaws, Kroger); Rakuten đọc đủ 45 sản phẩm/trang.
- Pháp: thêm Carrefour (giải mã dữ liệu gốc, có EAN), Auchan, Chronodrive, Monoprix.
- Tìm ở nước ngoài không còn dịch tên thương hiệu ("nestle" từng thành "se nicher") và giữ từ khóa đã đúng ngôn ngữ thị trường.
- Tìm theo nhóm nhỏ trang bán qua Serper, Google Shopping đọc nhiều trang; cài đặt **Độ phủ tìm kiếm** (Tiết kiệm / Cân bằng / Sâu).
- Nút **Dừng** tìm kiếm, nút **Tìm mới** thay phiên cũ, **Dừng phân tích** ở tab Cơ hội nhập khẩu.
- Chạy được trên macOS (`chay-app.command`, `tao-app-macos.command`); yêu cầu Node ≥ 22.13.

**Trước đó**
- Giai đoạn 5: **Bán chạy theo nước** (Amazon Best Sellers 10 thị trường) đưa vào phân tích nhập khẩu chính ngạch.
- Phân tích nhập khẩu chạy 2 lượt (nhanh + bổ sung), lưu lịch sử lượt bán, điểm cơ hội, danh bạ nhà nhập khẩu.
- Cài đặt nguồn trong app, `chay-app.bat`, lấy thành phần và cách bảo quản của sản phẩm.

### Chưa làm

- Tra cứu đăng ký sản phẩm của Cục An toàn thực phẩm: trang tra cứu chính thức (`congbosanpham.vfa.gov.vn`, `nghidinh15.vfa.gov.vn`) chuyển hướng lỗi hoặc chặn truy cập tự động.
- Tích hợp Shopee Affiliate Open API (cần khóa do bạn đăng ký).
- Tiện ích Chrome cho các trang chặn bot.

## Cấu trúc mã

```
server.js                 Express: SSE /api/search, chi tiết, dịch, từ khoá, theo dõi, lịch sử, proxy ảnh
src/sources/              Mỗi nguồn một module: search({ q, market, signal }) → danh sách sản phẩm thô
src/lib/extract.js        Trích xuất chung: JSON-LD, JSON nhúng (Next/Redux/Apollo), thẻ sản phẩm, mục thành phần/bảo quản…
src/lib/normalize.js      Giá + tiền tệ, quy cách (g/ml), độ tuổi, loại SP, nhãn, dị ứng, thương hiệu, độ liên quan
src/lib/item.js           Chuẩn hoá thành dòng dữ liệu cho giao diện, quy đổi VNĐ, giá/100g
src/lib/enrich.js         Đọc trang chi tiết sản phẩm (có cache 24h)
src/lib/limiter.js        Giới hạn tốc độ theo nguồn + tạm nghỉ khi bị chặn
src/lib/translate.js      Dịch từ khoá (Google Translate web, dự phòng MyMemory) + thuật ngữ ăn dặm
public/                   Giao diện (HTML/CSS/JS thuần, không cần build)
data/                     Cache, danh sách theo dõi, lịch sử (tự tạo)
```

Thêm một shop mới: tạo object `{ id, name, kind: 'shop', group, markets, search }` trong `src/sources/`, rồi thêm vào `src/sources/index.js`. Nếu trang tìm kiếm của shop có JSON-LD hoặc JSON nhúng, chỉ cần khai báo URL bằng `storeSource()` trong `stores.js`.

Kiểm tra nhanh từng nguồn:

```bash
npm run test:sources -- "bột ăn dặm hipp"
```

## Triển khai miễn phí

App được thiết kế để **chạy trên máy cá nhân** (`npm start`). Đây cũng là cách cào ổn định nhất, vì IP gia đình ít bị chặn hơn IP máy chủ. Nếu muốn đưa lên mạng, có thể dùng Render, Railway hoặc Fly.io gói miễn phí (lệnh chạy `npm start`, cổng lấy từ biến `PORT`). Lưu ý IP datacenter bị các shop và search engine chặn nhiều hơn, nên khi đó nên cấu hình `SERPER_API_KEY` hoặc `SCRAPE_PROXY`.

## Lưu ý sử dụng

Công cụ phục vụ nghiên cứu thị trường cá nhân, gọi mỗi nguồn với tần suất thấp và có cache. Hãy tôn trọng điều khoản sử dụng của từng website, không dùng để cào hàng loạt hay tái xuất bản dữ liệu. Giá quy đổi chỉ mang tính tham khảo: chưa gồm phí vận chuyển, thuế nhập khẩu, và tỷ giá có thể chênh lệch.
