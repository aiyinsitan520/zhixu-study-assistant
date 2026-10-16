import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import { cva,type VariantProps } from 'class-variance-authority';
import { X,LoaderCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { cn } from './lib';

// shadcn/ui-style composable primitives, using Radix for focus, keyboard and dialog semantics.
const buttonVariants=cva('button',{variants:{variant:{default:'button-primary',outline:'button-outline',ghost:'button-ghost',danger:'button-danger'},size:{default:'',sm:'button-sm',icon:'button-icon'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({className,variant,size,asChild=false,busy=false,children,disabled,...props}:React.ComponentProps<'button'>&VariantProps<typeof buttonVariants>&{asChild?:boolean;busy?:boolean}){const Comp=asChild?Slot:'button';return <Comp className={cn(buttonVariants({variant,size}),className)} disabled={disabled||busy} {...props}>{busy&&<LoaderCircle className="spin" size={16}/>} {children}</Comp>;}
export function Modal({open,onClose,title,description,children,wide=false}:{open:boolean;onClose:()=>void;title:string;description?:string;children:React.ReactNode;wide?:boolean}){return <Dialog.Root open={open} onOpenChange={v=>!v&&onClose()}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className={cn('modal',wide&&'modal-wide')}><div className="modal-head"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description||'填写并确认后保存到本地。'}</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="关闭"><X size={20}/></Button></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;}
export function MathText({text,className=''}:{text:string;className?:string}){return <div className={'math-text '+className}><ReactMarkdown remarkPlugins={[remarkMath,remarkGfm]} rehypePlugins={[[rehypeKatex,{throwOnError:false,strict:false}]]} components={{a:({children,...p})=><a {...p} target="_blank" rel="noreferrer">{children}</a>,img:({src,alt})=>src?.startsWith('/api/attachments/')?<img src={src} alt={alt||'题目图片'}/>:<span>{alt||'[图片请查看原文]'}</span>}}>{text.replace(/\\\(/g,'$').replace(/\\\)/g,'$').replace(/\\\[/g,()=> '\n$$\n').replace(/\\\]/g,()=> '\n$$\n')}</ReactMarkdown></div>;}
export function Empty({icon:Icon,title,description,children}:{icon:React.ElementType;title:string;description:string;children?:React.ReactNode}){return <div className="empty"><div className="empty-icon"><Icon size={30} strokeWidth={1.5}/></div><h3>{title}</h3><p>{description}</p><div className="row center">{children}</div></div>;}
export function Field({label,children,hint}:{label:string;children:React.ReactNode;hint?:string}){return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
