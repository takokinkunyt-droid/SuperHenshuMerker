# フォント選択画面の見本用に、数文字だけを抜き出した小さなフォントを public/font-previews に作る開発用スクリプト。
# 使い方: pip install fonttools brotli のあと  python3 tools/gen-font-previews.py
import glob, os, re
from fontTools import subset
from fontTools.ttLib import TTFont

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sample = re.search(r"FONT_SAMPLE = '([^']+)'", open(os.path.join(root, 'src/fontList.ts'), encoding='utf-8').read()).group(1)
out = os.path.join(root, 'public/font-previews')
os.makedirs(out, exist_ok=True)
for pkg in re.findall(r"preview: '([^']+)'", open(os.path.join(root, 'src/fontList.ts'), encoding='utf-8').read()):
    files = os.path.join(root, 'node_modules/@fontsource', pkg, 'files')
    font = None
    # 日本語と英数字は別のファイルなので、両方から抜き出して1つにまとめる
    opts = subset.Options(flavor='woff2', layout_features=[], name_IDs=[], notdef_outline=True, drop_tables=['GSUB', 'GPOS', 'GDEF'])
    jp = TTFont(glob.glob(os.path.join(files, f'{pkg}-japanese-400-normal.woff2'))[0])
    cmap = jp.getBestCmap()
    have = ''.join(c for c in sample if ord(c) in cmap)
    s = subset.Subsetter(opts)
    s.populate(text=have)
    s.subset(jp)
    jp.flavor = 'woff2'
    jp.save(os.path.join(out, f'{pkg}.woff2'))
    print(pkg, have, os.path.getsize(os.path.join(out, f'{pkg}.woff2')))
