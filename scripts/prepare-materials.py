"""Render local source material without OCR substitution; never executes document text."""
from pathlib import Path
import json, shutil
import pymupdf
import numpy as np
from PIL import Image

APP=Path(__file__).resolve().parents[1]
SOURCE=Path('D:/xwechat_files/wxid_21n2uzpjigfg22_aca9/temp/RWTemp/2026-10/344ba739f67577dc81c52e43e220cedd')
OUT=Path('E:/AAA数据库/知序服务器/题目资料')
OUT.mkdir(parents=True,exist_ok=True)
manifest=[]
for filename in ['微积分BI标准化作业 （学生版）.pdf','高等数学（上册）精选750题 (宋浩)(1).pdf']:
    folder=OUT/Path(filename).stem; folder.mkdir(exist_ok=True)
    original=folder/filename
    if not original.exists(): shutil.copy2(SOURCE/filename,original)
    doc=pymupdf.open(original); pages=[]
    homework=filename.startswith('微积分')
    for i,page in enumerate(doc):
        p=i+1; target=folder/f'原页-{p:03d}.jpg'
        if not target.exists(): page.get_pixmap(matrix=pymupdf.Matrix(1.65,1.65)).save(target,jpg_quality=82)
        kind=('front' if p==1 else 'exercise') if homework else ('front' if p<10 else 'exercise' if p<=109 else 'reference')
        pages.append(dict(path=str(target),label=f'第 {p} 页',kind=kind))
    manifest.append(dict(name=folder.name,original=str(original),pages=pages,questions=[]))
    print(filename,len(pages),flush=True)

for name,filename in [('求导100题','求导100题(1).rar'),('求极限100题','求极限100题.rar')]:
    folder=OUT/Path(filename).stem; folder.mkdir(exist_ok=True)
    if not (folder/filename).exists(): shutil.copy2(SOURCE/filename,folder/filename)
    paths=json.loads((APP/'.local/previews'/f'{name}.json').read_text(encoding='utf-8'))
    pages=[]; questions=[]
    for i,path in enumerate(paths):
        target=folder/f'原图-{i+1:02d}.jpg'
        if not target.exists():shutil.copy2(path,target)
        kind='exercise' if name=='求导100题' and i in [0,1,2,3,13,14,18,20,21] else 'reference'
        pages.append(dict(path=str(target),label=f'原图 {i+1}',kind=kind))
    if name=='求导100题':
        for index,start,counts in [(1,12,[13,12]),(2,37,[13,12]),(3,62,[14,11]),(0,87,[13,1])]:
            im=Image.open(paths[index]).convert('RGB'); a=np.asarray(im).astype(int)
            green=(a[:,:,1]>a[:,:,0]+12)&(a[:,:,1]>a[:,:,2]+8)&(a[:,:,1]<245)
            divider=int(np.argmax((a[100:1900,630:780,:3].max(axis=2)<90).sum(axis=0)))+630
            number=start
            for col,count in enumerate(counts):
                x=0 if col==0 else 720
                rows=np.where(green[:,x:x+75].sum(axis=1)>4)[0]
                groups=[]
                for y in rows:
                    if not groups or y-groups[-1][-1]>18:groups.append([int(y)])
                    else:groups[-1].append(int(y))
                starts=[g[0] for g in groups if len(g)>=8]
                if len(starts)!=count:raise ValueError(f'Crop count mismatch {index} {col}: {starts}')
                for n,y in enumerate(starts):
                    bottom=starts[n+1]-10 if n+1<len(starts) else min(im.height,y+250)
                    target=folder/f'单题-{number:03d}.jpg'
                    im.crop((0 if col==0 else divider+4,max(0,y-10),divider-4 if col==0 else 1440,bottom)).save(target,quality=94)
                    questions.append(dict(number=number,path=str(target),page=index+1))
                    number+=1
        assert len(questions)==89
    manifest.append(dict(name=folder.name,pages=pages,questions=questions))
    print(name,len(pages),len(questions),flush=True)
(OUT/'导入清单.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('DONE',flush=True)
