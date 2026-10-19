export function insertAtSelection(value:string,start:number,end:number,text:string){
 const from=Math.max(0,Math.min(start,value.length)),to=Math.max(from,Math.min(end,value.length));
 return {value:value.slice(0,from)+text+value.slice(to),cursor:from+text.length};
}
export const mathTemplates=[
 {id:'fraction',name:'分数',symbol:'a/b',fields:['分子','分母'],defaults:['1','2']},
 {id:'power',name:'乘方',symbol:'xⁿ',fields:['底数','指数'],defaults:['x','2']},
 {id:'root',name:'根号',symbol:'√',fields:['根号内'],defaults:['x']},
 {id:'limit',name:'极限',symbol:'lim',fields:['变量','趋近于','表达式'],defaults:['x','0','sin(x)/x']},
 {id:'integral',name:'积分',symbol:'∫',fields:['被积函数','积分变量','下限（可空）','上限（可空）'],defaults:['x^2','x','','']},
 {id:'derivative',name:'导数',symbol:'d/dx',fields:['函数','变量'],defaults:['f(x)','x']},
] as const;
export function formulaText(id:string,values:string[]){
 const [a='',b='',c='',d='']=values.map(v=>v.replace(/\$/g,'').trim());
 const body=id==='fraction'?`\\frac{${a}}{${b}}`:id==='power'?`{${a}}^{${b}}`:id==='root'?`\\sqrt{${a}}`:id==='limit'?`\\lim_{${a} \\to ${b}} ${c}`:id==='integral'?`\\int${c?`_{${c}}`:''}${d?`^{${d}}`:''} ${a} \\, d${b}`:`\\frac{d}{d${b}} ${a}`;
 return `$${body}$`;
}
