# @nxvet/nxst-hl7-parser

[English](README.md) · 繁體中文

給 NxVet SyncTool 儀器外掛（device plugin）用的 **HL7 v2.x 與 MLLP 通用工具**，與儀器無關：
MLLP 切框、段落／欄位／成分的讀取，以及 HL7 時間字串。

- **純函式、零 I/O、零 runtime 依賴。** 不 import 任何 `node:*` 模組，執行期唯一用到的 API 是全域
  的 `Buffer`。
- **刻意容錯。** 下面每一條容錯規則都來自實務上真的遇過的訊息，而且每一條都有單元測試釘住。
  每條規則的來由另外整理在〈[容錯規則的來由](#容錯規則的來由)〉。
- **為單檔外掛 bundle 而做。** 用 [`@nxvet/nxst-plugin`](https://www.npmjs.com/package/@nxvet/nxst-plugin)
  打包的外掛會把這個套件內聯進 `main.cjs`，`.nxplugin` 仍然是單檔自足的。

這個套件**刻意不知道**的事：病歷號放在哪一欄、哪些 OBX 是檢驗結果、QC 訊息長什麼樣子、某一台
儀器要求的 ACK 表頭怎麼排。這些是儀器語意，留在各個外掛裡（見〈[給外掛作者：怎麼接](#給外掛作者怎麼接)〉）。

---

## 安裝

```bash
npm install @nxvet/nxst-hl7-parser
```

需要 **Node 22 以上**。套件是 ESM，發佈的是編譯好的 JavaScript 加上型別宣告（`dist/*.js` +
`dist/*.d.ts`）。esbuild 之類的 bundler 可以直接處理；純 CommonJS 的程式在支援 `require(esm)` 的
Node 版本（22.12 起）可以直接 `require()`。

## 快速開始

一個最小的 MLLP 接收端：每條連線各自累積位元組、切出完整的 frame、讀幾個欄位、回 ACK。

```ts
import type { Hl7Segment } from '@nxvet/nxst-hl7-parser'
import {
  extractMllpFrames,
  field,
  findSegment,
  hl7Timestamp,
  normalizeHl7Date,
  parseMessage,
  sanitizeHl7Text,
  wrapMllp,
} from '@nxvet/nxst-hl7-parser'

let pending: Buffer = Buffer.alloc(0)

const onData = (chunk: Uint8Array): Uint8Array[] => {
  const { frames, rest, discarded } = extractMllpFrames(Buffer.concat([pending, Buffer.from(chunk)]))

  pending = rest // 還沒收完的尾巴留給下一個 chunk
  if (discarded > 0) console.debug(`dropped ${discarded} byte(s) outside any frame`) // 只記數量，不記內容

  return frames.map((text) => {
    const segments: Hl7Segment[] = parseMessage(text)
    const msh = findSegment(segments, 'MSH')
    const obr = findSegment(segments, 'OBR')

    const controlId = field(msh, 10).trim() // MSH-10，編號與規格書一致
    const observedAt = normalizeHl7Date(field(obr, 7)) ?? normalizeHl7Date(field(msh, 7))

    // ……從 OBX 段組出檢驗結果……

    const ack = [
      `MSH|^~\\&|LIS||${field(msh, 3)}|${field(msh, 4)}|${hl7Timestamp(new Date())}||ACK|1|P|2.4`,
      `MSA|AA|${controlId}|${sanitizeHl7Text('Message accepted.')}`,
    ].join('\r')

    return wrapMllp(`${ack}\r`)
  })
}
```

## API

### MLLP

| 匯出 | 說明 |
|---|---|
| `MLLP_START` | `0x0B`，`<SB>`：每個 frame 的第一個位元組。 |
| `MLLP_END` | `0x1C`，`<EB>`：frame 的結束位元組。 |
| `MLLP_CR` | `0x0D`，`<CR>`：通常緊接在 `<EB>` 之後。 |
| `interface MllpExtraction` | `{ frames: string[], rest: Buffer, discarded: number }` |
| `extractMllpFrames(buffer: Buffer): MllpExtraction` | 從累積的位元組裡切出所有完整的 frame。 |
| `wrapMllp(text: string): Uint8Array` | `<SB>` + UTF-8 文字 + `<EB><CR>`。 |

`extractMllpFrames` 的規則：

- 一個 chunk 可能有好幾個 frame；一個 frame 也可能跨好幾個 chunk。還沒收完的尾巴放在 `rest` 回傳，
  呼叫端要把它接在下一個 chunk 前面。`rest` 不是空的，就是以 `<SB>` 開頭。
- `rest` 是獨立複製的一份，不是 `buffer` 的 view，所以留著它不會連帶留住一大塊輸入 buffer。
- `<SB>` 之前的位元組是噪音（開機輸出、上一個 frame 殘留的位元組），一律丟掉，只把**數量**記在
  `discarded`；內容永遠不回傳，所以不可能流進日誌。
- `<EB>` 之後緊接的 `<CR>` 會一併消耗；缺了 `<CR>` 也照樣切。`<CR>` 如果晚到、落在下一個 chunk 的
  開頭，會被當成 1 位元組的噪音丟掉——無害，因為 frame 已經在上一輪切好了。
- frame 內容以 UTF-8 解碼。

### 訊息結構

| 匯出 | 說明 |
|---|---|
| `interface Hl7Segment` | `{ name: string, fields: string[] }`；`fields[0]` 是段名。 |
| `parseMessage(text: string): Hl7Segment[]` | 把訊息切成段落與欄位。 |
| `field(segment: Hl7Segment \| undefined, n: number): string` | 第 `n` 欄，編號與 HL7 規格書一致。 |
| `component(value: string, index: number): string` | 以 `^` 分隔的值的第 `index` 個成分（1-based）。 |
| `findSegment(segments, name): Hl7Segment \| undefined` | 第一個叫這個名字的段落。 |
| `findSegments(segments, name): Hl7Segment[]` | 所有叫這個名字的段落，依訊息內順序。 |
| `sanitizeHl7Text(text: string): string` | 把自由文字處理成可以安全放進欄位的形式。 |

規則：

- **段落結束符**：`\r`（標準）、`\r\n`、`\n` 都接受，同一則訊息裡混用也可以。
- **整行 trim**：每一行先修掉前後空白（空格、tab）再以 `|` 切欄位。`|` 不是空白，所以欄位結構
  永遠不會變；被修掉的只有第一個欄位最前面、最後一個欄位最後面的空白。欄位中間的空白照留。
- **空白行**（結尾多出來的結束符、空行、只有空白的行）直接略過。
- **段名會 trim**，所以 `PID |...` 仍然找得到 `PID`。
- **MSH 的欄位偏移**：MSH 段的欄位分隔符本身就是 MSH-1，所以 `MSH-n = fields[n-1]`；其他段落是
  `SEG-n = fields[n]`。`field()` 已經吸收這個差異：`field(msh, 10)` 就是 MSH-10，`field(obx, 5)` 就是
  OBX-5。
- **不回 `undefined`**：段落不存在或欄位沒送，`field()` 回 `''`；`component()` 的索引超出範圍回 `''`，
  沒有 `^` 的值本身就是第 1 個成分。
- **只認預設分隔符**：欄位以 `|` 切、成分以 `^` 切。重複（`~`）、子成分（`&`）與跳脫序列
  （`\F\`、`\S\`……）原樣回傳，不解碼。
- `sanitizeHl7Text` 把 `|`、`^`、`~`、`\`、`&`、`\r`、`\n` 換成空白，再修掉前後空白。凡是不是自己寫
  的文字（例如要放進 MSA-3 的錯誤訊息）都先過它。

### 時間

| 匯出 | 說明 |
|---|---|
| `hl7Timestamp(date: Date): string` | 本機時間 → `yyyyMMddHHmmss`。 |
| `hl7TimestampWithOffset(date: Date): string` | 本機時間 → `YYYYMMDDHHMMSS±ZZZZ`。 |
| `normalizeHl7Date(raw: string \| undefined): string \| undefined` | HL7 時間字串 → `yyyyMMddHHmmss`，湊不出來回 `undefined`。 |

規則：

- 一律用**本機的牆上時間**，任何地方都不做時區換算。SyncTool 的 `ExamPayload.date` 是不帶時區的
  `yyyyMMddHHmmss`，而儀器與它回報的那台 SyncTool 電腦在同一間診所、看的是同一個時鐘。
- `hl7Timestamp` 的年份一律補滿 4 位。
- `hl7TimestampWithOffset` 會把 `Date#getTimezoneOffset()` 的正負號反過來（UTC+9 寫成 `+0900`）。
- `normalizeHl7Date`：trim → 剝掉尾端的 UTC 偏移（`+0800`、`-0500`、`+08:00`）→ 濾掉其餘非數字 →
  取前 14 碼。不足 14 碼回 `undefined`，讓呼叫端改用下一個來源。

| 輸入 | 結果 |
|---|---|
| `20230615170942` | `20230615170942` |
| `20230615170942+0800`、`20230615170942+08:00` | `20230615170942` |
| `20230615170942.123`（小數秒） | `20230615170942` |
| `2023-06-15 17:09:42` | `20230615170942` |
| `20131001093000l`（尾巴多一個雜字元） | `20131001093000` |
| `202306151709+0800`（只到分鐘 + 偏移） | `undefined`（偏移永遠不會被當成秒數） |
| `20230615`（只有日期）、`''`、`undefined` | `undefined` |

## 容錯規則的來由

每一條都有對應的單元測試；要改規則，請先讀懂這裡的理由，並同步修改測試與 `CHANGELOG.md`。

### MLLP 切框

| 規則 | 為什麼 |
|---|---|
| 一個 chunk 多個 frame、一個 frame 跨多個 chunk | TCP 是位元組串流，不保證「一次 `data` 事件 = 一則訊息」。實務上兩種情況都很常見：儀器連續送出兩筆結果會擠在同一個 chunk；一則 2 KB 的訊息被切成好幾段也是常態。假設「一個 chunk 一則訊息」的實作，會在某一天突然開始掉資料或解析失敗。 |
| `<SB>` 之前的位元組丟掉並計數 | 有些儀器開機時會先吐一段非 HL7 的輸出，也可能在兩則訊息之間殘留單一位元組。這些不是訊息的一部分，丟掉才能重新對齊到下一個 `<SB>`。 |
| 噪音**只回報數量、不回報內容** | 噪音可能是別台裝置的資料（例如埠號設錯、共用一個轉換器），裡面可能有病患資料。只給數量，呼叫端就算把它寫進日誌也不會外洩內容。 |
| 缺 `<CR>` 也照切 | 有些對端在 `<EB>` 後面不送 `<CR>`。嚴格要求 `<EB><CR>` 的實作會一直等一個永遠不會來的位元組，那則訊息就卡死在 buffer 裡。 |
| 晚到的 `<CR>` 當 1 位元組噪音 | `<EB>` 與 `<CR>` 可能被 TCP 切在兩個 chunk。frame 在看到 `<EB>` 時就已經完整，晚到的 `<CR>` 丟掉即可。HL7 內容不會出現 `<SB>`（`0x0B`），所以丟噪音的時候不可能誤吃下一個 frame。 |
| `rest` 複製一份 | 呼叫端通常是「把 `rest` 與新 chunk 串起來再切」，連線可能開好幾個小時。`rest` 若是 view，一個還沒收完的小尾巴就會把整塊串接出來的大 buffer 一直留在記憶體裡。 |

### 訊息結構

| 規則 | 為什麼 |
|---|---|
| `\r`、`\r\n`、`\n` 都接受 | 規格書寫的是 `\r`，但實務上見過直接送 `\r\n` 的儀器韌體，也見過經過 Windows 工具轉存、變成 `\r\n` 或 `\n` 的訊息。只認 `\r` 的話，整則訊息會被當成一個巨大的 MSH 段，所有欄位都讀錯。 |
| 整行 trim | 有些對端會在行首多送縮排、行尾多送空白。`|` 不是空白，所以 trim 不會移動任何欄位；它只影響第一個與最後一個欄位的外側空白，而這些空白本來就沒有意義（呼叫端讀欄位時通常也會再 `.trim()`）。 |
| 略過空白行 | 訊息結尾的結束符、`\r\n` 被拆成兩個結束符、中間多出的空行，都會產生空段落。把它們當成段落只會多出名字是空字串的假段。 |
| 段名 trim | `PID |...` 這種段名與 `|` 之間多一個空白的寫法，若不 trim，`findSegment(segments, 'PID')` 會找不到整段，後面的欄位全部變成空字串，而且不會有任何錯誤訊息。 |
| MSH 的欄位偏移收在 `field()` 裡 | HL7 規定 MSH 段的欄位分隔符 `|` 本身就是 MSH-1，所以 MSH 的索引比其他段少一。這是 HL7 實作最常見的差一錯誤；集中在 `field()` 處理之後，呼叫端一律照規格書上的編號寫（`field(msh, 10)` 就是 MSH-10），不必各自記得減一。 |
| 回 `''` 而不是 `undefined` | 讀欄位之後幾乎一定會接 `.trim()`、`component()` 或字串比對。統一回空字串，呼叫端就不必在每一處加 `?? ''`，也不會因為漏加而在某一則缺欄位的訊息上拋例外。 |
| 只認預設分隔符、不解跳脫序列 | 實務上的儀器幾乎都用預設的 `^~\&`。解跳脫序列或依 MSH-2 換分隔符，都會改變欄位內容，最好由了解該儀器的外掛決定要不要做；這個套件只保證「原樣切開」。 |
| `sanitizeHl7Text` | 自由文字（例如錯誤訊息）裡只要有一個 `|` 或換行，放進 MSA-3 之後整則 ACK 的欄位就全部錯位，儀器可能因此拒收或重送。先把分隔符與換行換成空白，就不可能組出壞掉的訊息。 |

### 時間

| 規則 | 為什麼 |
|---|---|
| 不做時區換算 | `ExamPayload.date` 沒有時區欄位，平台端照牆上時間顯示。儀器與 SyncTool 在同一間診所，照儀器報的牆上時間收下就是對的；換算反而會在儀器時區設錯（很常見）時把時間推到錯的一天。 |
| 先剝掉 UTC 偏移、再濾非數字 | HL7 的時間型別允許尾端帶 `±ZZZZ`。若直接濾掉所有非數字再取前 14 碼，一個只到分鐘又帶偏移的值（`202306151709+0800`）會變成 `20230615170908`——把時區的 `08` 當成秒數，得到一個**看起來合法但是錯的時間**。先剝掉偏移，這種值就只剩 12 碼、回 `undefined`，呼叫端會改用下一個來源。 |
| 接受 `+08:00` 的冒號寫法 | 有些系統把偏移寫成 ISO 8601 的 `+08:00`。 |
| 濾掉其餘非數字 | 小數秒（`.123`）、`-`／`:`／空白分隔的寫法、尾端多一個雜字元，實務上都見過。濾掉之後取前 14 碼就能收斂。 |
| 不足 14 碼回 `undefined` | 只有日期（`YYYYMMDD`）或只到分鐘的值，補零會捏造出一個時分秒。回 `undefined` 讓呼叫端依序改用其他時間欄位（例如 OBX-14、MSH-7）。另外，**時間最好是決定性的**：同一筆結果重送時，若退到「收到當下的時間」，下游以內容判斷重複的機制就會把它當成新結果。 |
| 年份補滿 4 位 | 小於 1000 的年份若不補零，整個字串會少一碼，後面每一段（月、日、時……）都跟著錯位。這種年份實務上不會出現，但格式保證是 14 碼就該永遠是 14 碼。 |
| 偏移的正負號反過來 | `Date#getTimezoneOffset()` 回傳的是「UTC 減本地」的分鐘數，UTC+9 會回 `-540`；HL7 要的是「本地相對 UTC」，所以要先取反。 |

## 給外掛作者：怎麼接

### 1. 加依賴

```bash
npm install @nxvet/nxst-hl7-parser
```

放在 `dependencies`，版本範圍用 `^1.x`（例如 `"@nxvet/nxst-hl7-parser": "^1.0.0"`）。
`@nxvet/nxst-plugin` 仍然是 `devDependencies`。

### 2. import

```ts
import type { Hl7Segment } from '@nxvet/nxst-hl7-parser'
import { extractMllpFrames, field, findSegment, parseMessage, wrapMllp } from '@nxvet/nxst-hl7-parser'
```

型別一律用 `import type`（外掛的測試靠 Node 的 type stripping 直接跑 `.ts`）。

### 3. 為什麼 `.nxplugin` 仍然是單檔自足的

`nxst-plugin build` 用 esbuild 打包（`bundle: true`、`platform: node`、`format: cjs`），`node_modules`
裡的依賴會被**內聯**進 `dist/main.cjs`。`nxst-plugin lint` 只允許 bundle 裡出現 Node 內建模組的
`require`；這個套件不 import 任何 `node:*` 模組，所以內聯之後不會多出任何 `require`。
`package.json` 宣告了 `"sideEffects": false`，esbuild 會把沒用到的函式 tree-shake 掉。

建置後可以自己確認：

```bash
npm run build
grep -c 'require("@nxvet' dist/main.cjs   # 應該是 0
```

### 4. 為什麼套件發佈的是編譯好的 JS

外掛的單元測試是 `node --test 'test/**/*.test.ts'`，靠 Node 22.18 起預設開啟的 type stripping
直接跑 TypeScript。但 Node **不會**對 `node_modules` 裡的 `.ts` 做 type stripping（會丟
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。所以這個套件發佈的是 `dist/*.js` 加
`dist/*.d.ts`，外掛的測試與 esbuild 都讀 JS，編輯器與型別檢查讀 `.d.ts`。

### 5. 哪些東西留在外掛裡

這個套件只做與儀器無關的事。以下一律留在外掛自己的 `protocol.ts`：

- ACK 的組法（MSH-3～6 的收發方向、MSH-9 的訊息型別、MSH-10 用流水號還是 UUID、要不要帶 MSA-3）；
- 哪些 OBX 進 `examList`、參考範圍怎麼拆、異常旗標怎麼讀；
- 病歷號在 PID 的哪一欄、QC 訊息怎麼判斷；
- 時間欄位的退路順序（OBR-7 → OBX-14 → MSH-7 → ……）。

### 6. 不要把副本搬回外掛

不要把這個套件的原始碼複製進外掛目錄。發現 HL7／MLLP 層的問題時：在這個 repo 修、補測試、
bump 版本、發佈，然後各外掛升級依賴。外掛裡留一份副本，就會回到「兩份各自漂移」的老路。

### 7. 本機同步開發

同時改這個套件與某個外掛、還沒發佈時：

```bash
# 在這個 repo
npm pack                                   # prepack 會先 build，產出 nxvet-nxst-hl7-parser-<版本>.tgz

# 在外掛目錄
npm install --no-save ../nxst-hl7-parser/nxvet-nxst-hl7-parser-<版本>.tgz
npm test && npm run build
```

`--no-save` 不會動到外掛的 `package.json` 與 lock 檔。也可以用 `npm link`（在這裡 `npm link`，
在外掛目錄 `npm link @nxvet/nxst-hl7-parser`），但記得每次改完都要在這裡重新 `npm run build`——
外掛讀的是 `dist/`，不是 `src/`。

**不得 commit `file:`、`link:` 或指向 tarball 的依賴規格**，也不要 commit 因此改變的 lock 檔。
外掛的 `package.json` 永遠寫發佈到 npm 上的版本範圍；套件發佈之後，再在外掛目錄跑一次一般的
`npm install` 更新 lock 檔。

## 開發

```bash
npm ci
npm test              # 先 build dist/、型別檢查 src/ 與 test/，再跑測試
npm pack --dry-run    # 列出實際會發佈的檔案
```

測試只用 Node 內建的測試執行器（`node:test`）與 `node:assert/strict`，並透過 Node 的 type stripping
直接跑 TypeScript 原始碼。因此原始碼要守 type stripping 的限制：不用 `enum`、`namespace`、建構子
參數屬性；純型別的 import 用 `import type`；相對路徑的 import 寫完整的 `.ts` 副檔名（build 時會
改寫成 `.js`）。`test/exports.test.ts` 以套件自己的名字 import，會經過 `exports` 對應到建置後的
`dist/`，所以進入點壞掉時測試會失敗。

### 發版

1. bump `package.json` 的 `version`，在 `CHANGELOG.md` 補上該版的條目。
2. commit 之後打 `vX.Y.Z` tag（必須與 `package.json` 的版本一致）並 push tag。
3. `release` workflow 會 build、跑測試、把打包出來的 tarball 實際安裝一次做 smoke test、透過 npm
   trusted publishing 帶 provenance 發佈到 npm（`v1.1.0-rc.0` 這類預發佈版發到 `rc` dist-tag），
   最後把 tarball 附在 GitHub Release 上。

已發佈的版本不會被覆寫：發現某一版有問題，就發一個新版本。
如果 tag 對應的版本已經在 npm 上（例如 1.0.0：trusted publishing 只能替已存在的套件設定，所以
首發是手動發的），workflow 會跳過 publish 這一步、照樣建立 GitHub Release；因此發到一半失敗的
release 也可以放心重跑。

## 版本規則

遵循 [語意化版本](https://semver.org/lang/zh-TW/)。公開 API 是上面列出的 runtime 匯出與兩個型別。
任何「同一個輸入、回傳值不同」的變更都記在 [CHANGELOG.md](CHANGELOG.md)；可能改變使用者既有結果
的變更屬於 major 版。

## 授權

[Apache-2.0](LICENSE)
