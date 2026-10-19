import './copyright.css';
export function Copyright({inline=false}:{inline?:boolean}){
 return <div className={inline?'copyright-notice':'site-copyright'} aria-label="版权与商业使用联系"><span>yh版权所有</span><span>商用请加微信Yh19883956678</span></div>;
}
