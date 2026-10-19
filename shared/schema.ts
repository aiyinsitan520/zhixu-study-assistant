import { z } from 'zod';
import {knowledgeTopicIds} from './knowledge.ts';

export const questionTypes = ['单选', '多选', '判断', '填空', '计算', '证明'] as const;
export const sourceSchema = z.object({attachmentId:z.string(), name:z.string(), page:z.number().int().positive().optional(), imageId:z.string().optional()});
export const questionInput = z.object({
  title:z.string().trim().min(1).max(200), stem:z.string().trim().min(1).max(100000),
  type:z.enum(questionTypes).default('计算'), subject:z.string().max(80).default('高等数学'),
  options:z.array(z.string().max(10000)).max(20).default([]), answer:z.string().max(30000).default(''),
  explanation:z.string().max(100000).default(''), answerOrigin:z.enum(['原文','人工','AI','无']).default('无'),
  explanationOrigin:z.enum(['原文','人工','AI']).optional(),
  solutionVersion:z.string().max(40).optional(),solutionModel:z.string().max(120).optional(),solutionCompletedAt:z.string().optional(),
  answerConfirmed:z.boolean().default(false), subquestions:z.array(z.string().max(20000)).max(50).default([]),
  sources:z.array(sourceSchema).max(300).default([]), folderId:z.string().nullable().default(null),
  materialKind:z.enum(['question','page']).default('question'),
  knowledgePoints:z.array(z.string().refine(id=>knowledgeTopicIds.has(id),'未知知识点')).max(12).optional(),
  knowledgeSource:z.enum(['auto','manual','AI']).optional(),
});
export type QuestionInput = z.infer<typeof questionInput>;
export type Question = QuestionInput & {ownerId?:string;id:string; createdAt:string; updatedAt:string; deleted:boolean; wrong:boolean; mastered:boolean};
export type Folder = {ownerId?:string;id:string; name:string; parentId:string|null; deleted:boolean; deletedBatch?:string};
export type Document = {id:string;name:string;folderId:string;attachmentId?:string;pages:{imageId:string;label:string;kind:'exercise'|'reference'|'front'}[]};
export type Attachment = {id:string; name:string; mime:string; hash:string; size:number; ownerId?:string};
export const aiReviewSchema=z.object({id:z.string().uuid(),suggestedCorrect:z.boolean().nullable(),feedback:z.string().max(50000),fingerprint:z.string().optional(),createdAt:z.string(),model:z.string(),decision:z.enum(['pending','adopted','overridden']),confirmedAt:z.string().optional()});
export type Attempt = {id:string; questionId:string; answer:string; images:string[]; correct:boolean|null; judgement:'自动'|'人工'|'AI'; feedback:string; createdAt:string; aiReview?:z.infer<typeof aiReviewSchema>};
export type Draft = {id:string; answer:string; images:string[]; updatedAt:string; revision?:number};
export type Explanation = {fingerprint?:string;id:string; questionId:string; content:string; createdAt:string; model:string};
export type Reward = {id:string; points:number; createdAt:string};
export type JobTask = {id:string; source:z.infer<typeof sourceSchema>; text?:string; imageId?:string; status:'pending'|'done'|'error'; error?:string};
export type ImportDraft = QuestionInput & {id:string};
export type ImportJob = {ownerId?:string;id:string; name:string; folderId:string|null; attachmentIds:string[]; status:'preparing'|'running'|'review'|'error'|'cancelled'|'committed'; tasks:JobTask[]; drafts:ImportDraft[]; errors:string[]; duplicates:string[]; createdAt:string; committedIds?:string[]};
export type Settings = {baseUrl:string; visionBaseUrl:string; model:string; visionModel:string; hasKey:boolean; hasVisionKey:boolean};
export type Stats = {questions:number; attempts:number; correct:number; correctQuestions:number; wrong:number; points:number; level:number; eligible:Question[]; claimed:string[]; mastered:number; activeDays:number; recent:{date:string; count:number}[]};
export type Bootstrap = {folders:Folder[]; questions:Question[]; jobs:ImportJob[]; attempts:Attempt[]; stats:Stats};
export const announcementInput=z.object({title:z.string().trim().min(1).max(100),content:z.string().trim().min(1).max(20000),pinned:z.boolean().default(false)});
export const announcementSchema=announcementInput.extend({id:z.string().uuid(),published:z.boolean(),authorName:z.string(),createdAt:z.string(),updatedAt:z.string(),publishedAt:z.string()});
export type Announcement=z.infer<typeof announcementSchema>;
export const attemptInput=z.object({answer:z.string().max(100000),images:z.array(z.string()).max(10).default([])});
export const draftInput=attemptInput.extend({revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()});
export const importOutput=z.object({questions:z.array(questionInput.omit({folderId:true,sources:true,answerConfirmed:true,answerOrigin:true,knowledgeSource:true})).max(100)});
export const gradingOutput=z.object({correct:z.boolean().nullable(),feedback:z.string().min(1).max(50000)});
