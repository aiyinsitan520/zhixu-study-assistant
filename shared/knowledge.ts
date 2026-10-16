// Application taxonomy, adapted from the cited textbook and exercise-book topics.
export const knowledgeSources=[
 {title:'同济大学《高等数学》第八版（上册）',url:'https://xuanshu.hep.com.cn/front/book/findBookDetails?bookId=62cdab46938b7cc2960eedb1'},
 {title:'同济大学《高等数学》第八版（下册）',url:'https://xuanshu.hep.com.cn/front/book/findBookDetails?bookId=62bc8b97938b7cc2960eebb7'},
 {title:'吉米多维奇《数学分析习题集》',url:'https://xuanshu.hep.com.cn/front/book/findBookDetails?bookId=59cdcff6ba9eb884cf81c464'},
];
type Topic={id:string;name:string;pattern:RegExp};
type Chapter={id:string;name:string;topics:Topic[]};
const topic=(id:string,name:string,pattern:RegExp):Topic=>({id,name,pattern});
export const knowledgeChapters:Chapter[]=[
 {id:'limits',name:'函数与极限',topics:[
  topic('function','函数、映射与性质',/定义域|值域|反函数|奇偶性|周期性|复合函数/),
  topic('sequence-limit','数列极限',/数列.{0,12}(极限|收敛)|递推|\\lim\s*[_{]*(?:n|k)/i),
  topic('function-limit','函数极限与运算法则',/极限|\\lim\b|\blim\s*[_({]/i),
  topic('infinitesimal','无穷小、等价替换与比较',/无穷小|无穷大|等价替换|等价代换|高阶小量/),
  topic('limit-criteria','夹逼准则与重要极限',/夹逼|夹挤|两个重要极限|重要极限|单调有界/),
  topic('continuity','连续性与间断点',/连续|间断点|间断类型/),
  topic('continuous-properties','介值、零点与最值定理',/介值定理|零点定理|一致连续|闭区间.{0,10}(连续|有界)/),
 ]},
 {id:'derivatives',name:'导数与微分',topics:[
  topic('derivative','导数概念与求导法则',/求导|求.{0,8}导数|导函数|导数定义|可导|微商|[fy]\s*(?:'|′)|\\frac\s*\{d[fy]\}\s*\{dx\}/i),
  topic('chain-rule','复合函数、反函数与链式法则',/链式|复合函数.{0,10}(求导|导数)|反函数.{0,10}(求导|导数)/),
  topic('higher-derivative','高阶导数',/高阶导数|二阶导数|三阶导数|[nN]阶导数|[fy]\s*(?:''|″)|[fy]\^\{?\([n2-9]\)/),
  topic('implicit-derivative','隐函数、参数方程与相关变化率',/隐函数.{0,15}(导数|求导)|参数方程.{0,15}(导数|求导)|相关变化率/),
  topic('differential','一元函数微分与近似计算',/求微分|微分近似|一阶微分|微分的定义|微分运算/),
 ]},
 {id:'derivative-apps',name:'中值定理与导数应用',topics:[
  topic('mean-value','罗尔、拉格朗日与柯西中值定理',/罗尔|罗 Rolle|Rolle|拉格朗日中值|柯西中值|微分中值|中值定理/i),
  topic('lhopital','洛必达法则',/洛必达|L['’]?H[oô]pital/i),
  topic('taylor','泰勒公式与展开',/泰勒|Taylor|麦克劳林|Maclaurin/i),
  topic('monotonicity','单调性、凹凸性与拐点',/单调区间|单调性|增减性|凹凸|拐点/),
  topic('extrema','极值、最值与优化',/极值|极大值|极小值|最大值|最小值|最优化/),
  topic('graph-curvature','函数图形、渐近线与曲率',/渐近线|曲率|描绘.{0,8}图形|函数作图|切线|法线/),
  topic('approximate-root','方程近似解',/二分法|牛顿迭代|切线法|割线法|方程的近似解/),
 ]},
 {id:'indefinite',name:'不定积分',topics:[
  topic('antiderivative','原函数与不定积分',/不定积分|原函数|\\int\s*(?![_^])/),
  topic('substitution','换元积分法',/换元|变量代换|凑微分/),
  topic('parts','分部积分法',/分部积分/),
  topic('rational-integral','有理函数与三角有理式积分',/有理函数.{0,12}积分|三角有理|部分分式/),
 ]},
 {id:'definite',name:'定积分',topics:[
  topic('definite-integral','定积分概念、性质与计算',/(?<!不)定积分|\\int\s*[_^]|积分中值|黎曼和|Riemann/i),
  topic('fundamental','变上限积分与微积分基本定理',/变上限|积分上限|牛顿.{0,4}莱布尼[茨兹]|微积分基本/),
  topic('improper','反常积分与审敛',/反常积分|广义积分|无穷限积分|瑕积分|\\int\s*[_^].{0,30}\\infty/),
  topic('gamma','Gamma函数与含参积分',/伽[玛马]|Gamma|Γ|含参.{0,6}积分|参数积分/i),
 ]},
 {id:'integral-apps',name:'定积分的应用',topics:[
  topic('area-volume','平面面积与旋转体体积',/旋转体|平面.{0,8}面积|围成.{0,12}(面积|体积)|所围.{0,12}(面积|体积)/),
  topic('arc-length','弧长与旋转曲面面积',/弧长|旋转曲面.{0,8}面积/),
  topic('integral-physics','功、水压力与物理应用',/变力|水压力|积分.{0,8}(功|引力)|质心|转动惯量/),
 ]},
 {id:'ode',name:'微分方程',topics:[
  topic('ode-basics','微分方程、通解与初值问题',/微分方程|初值问题|通解|特解|[yY]\s*(?:''|″)\s*[+\-=]/),
  topic('separable','可分离变量与齐次方程',/分离变量|可分离|齐次微分|齐次方程/),
  topic('first-order','一阶线性与伯努利方程',/一阶线性|伯努利方程|Bernoulli/i),
  topic('higher-ode','降阶与高阶线性方程',/降阶|二阶.{0,8}微分方程|高阶.{0,8}微分方程|常数变易/),
  topic('constant-ode','常系数方程与特征方程',/常系数|特征方程|欧拉方程/),
 ]},
 {id:'geometry',name:'向量代数与空间解析几何',topics:[
  topic('vectors','向量运算与数量积、向量积',/向量|数量积|向量积|混合积|叉积|点积/),
  topic('plane-line','空间直线与平面',/平面方程|直线方程|点法式|点向式|直线与平面|空间直线/),
  topic('surfaces','空间曲线、曲面与投影',/二次曲面|旋转曲面|柱面|球面|椭球面|抛物面|空间曲线|坐标面.{0,8}投影/),
 ]},
 {id:'multivariable',name:'多元函数微分法及应用',topics:[
  topic('multi-limit','多元函数极限与连续性',/二元函数.{0,10}(极限|连续)|多元函数.{0,10}(极限|连续)|二重极限/),
  topic('partial','偏导数与全微分',/偏导|全微分|\\partial/),
  topic('multi-chain','多元复合与隐函数求导',/多元复合|隐函数组|方程组.{0,10}(求导|偏导)/),
  topic('gradient','方向导数与梯度',/方向导数|梯度|\\nabla/),
  topic('tangent-plane','切平面与法线',/切平面|法平面/),
  topic('multi-extrema','多元极值与条件极值',/条件极值|拉格朗日乘数|拉格朗日乘子|二元函数.{0,15}(极值|最值)|多元函数.{0,15}(极值|最值)|Hess(?:e|ian)/i),
 ]},
 {id:'multiple-integrals',name:'重积分',topics:[
  topic('double-integral','二重积分与积分次序',/二重积分|二次积分|交换积分次序|\\iint|\\int.{0,60}\\int/),
  topic('polar-integral','极坐标与重积分换元',/极坐标|雅可比|Jacobi/i),
  topic('triple-integral','三重积分与柱、球坐标',/三重积分|\\iiint|柱坐标|球坐标/),
  topic('multiple-apps','重积分的几何与物理应用',/重积分.{0,20}(面积|体积|质心|惯量|引力)/),
 ]},
 {id:'line-surface',name:'曲线积分与曲面积分',topics:[
  topic('line-integral','两类曲线积分',/曲线积分|第一类曲线|第二类曲线|\\oint/),
  topic('green','格林公式与路径无关',/格林|Green|路径无关|与路径无关/i),
  topic('surface-integral','两类曲面积分',/曲面积分|第一类曲面|第二类曲面/),
  topic('gauss','高斯公式、通量与散度',/高斯公式|Gauss|通量|散度/i),
  topic('stokes','斯托克斯公式、环流与旋度',/斯托克斯|Stokes|环流|旋度/i),
 ]},
 {id:'series',name:'无穷级数',topics:[
  topic('numeric-series','常数项级数与审敛',/级数|审敛|正项|交错|绝对收敛|条件收敛|\\sum/),
  topic('power-series','幂级数与收敛域',/幂级数|收敛半径|收敛区间|收敛域/),
  topic('series-expansion','函数展开成幂级数',/展开.{0,8}幂级数|幂级数展开/),
  topic('uniform-series','函数项级数与一致收敛',/一致收敛|函数项级数/),
  topic('fourier','傅里叶级数',/傅里叶|Fourier|正弦级数|余弦级数/i),
 ]},
];
export const knowledgeTopics=knowledgeChapters.flatMap(c=>c.topics.map(t=>({...t,chapterId:c.id,chapterName:c.name})));
export const knowledgeTopicIds=new Set(knowledgeTopics.map(t=>t.id));
export const topicName=(id:string)=>knowledgeTopics.find(t=>t.id===id)?.name||id;
type Classifiable={title:string;stem:string;subject:string;subquestions?:string[];materialKind?:string;knowledgePoints?:string[];knowledgeSource?:'auto'|'manual'|'AI'};
export function inferKnowledge(q:Classifiable):string[]{
 if(q.materialKind==='page'||!/高等数学|微积分|数学分析/.test(q.subject))return [];
 const text=[q.title,q.stem,...q.subquestions||[]].join('\n');
 const found=new Set(knowledgeTopics.filter(t=>t.pattern.test(text)).map(t=>t.id));
 if(!/积分|原函数|\\int|\\iint|\\iiint/.test(text))for(const id of ['substitution','parts','rational-integral'])found.delete(id);
 // Avoid interpreting each symbol in higher-dimensional calculus as a separate one-variable exercise.
 if(found.has('partial')||found.has('multi-limit')||found.has('multi-extrema'))for(const id of ['derivative','implicit-derivative','extrema','function-limit','differential'])found.delete(id);
 if(['double-integral','triple-integral','line-integral','surface-integral'].some(id=>found.has(id)))for(const id of ['antiderivative','definite-integral','double-integral']){if(id!=='double-integral'||found.has('triple-integral'))found.delete(id);}
 if(found.has('ode-basics'))for(const id of ['derivative','higher-derivative'])found.delete(id);
 if(found.has('sequence-limit'))found.delete('function-limit');
 if(found.has('power-series')||found.has('fourier')||found.has('uniform-series'))found.delete('numeric-series');
 return [...found].slice(0,12);
}
export function withKnowledge<T extends Classifiable>(q:T):T{
 const source=q.knowledgeSource||'auto';
 return {...q,knowledgeSource:source,knowledgePoints:source==='auto'?inferKnowledge(q):[...new Set(q.knowledgePoints||[])].filter(id=>knowledgeTopicIds.has(id)).slice(0,12)};
}
