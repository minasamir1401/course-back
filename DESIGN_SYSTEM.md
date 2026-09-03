# ⚠️ CRITICAL NOTICE FOR ALL AI CODING ASSISTANTS
> **You MUST read this entire document before writing any code, proposing edits, or deleting components in this repository.**
> **Strict adherence to all guidelines, line limits, and communication specifications detailed below is 100% mandatory.**

---

# Klevro Educational Design System & Architecture Specification

This document serves as the **authoritative visual, architectural, and development manual** for the LMS Platform. All developers and AI coding assistants MUST strictly follow these design tokens, component modularity limits, communication protocols, file mappings, and architectural guardrails.

---

## 1. Core Philosophy & Aesthetic Vision

The LMS Platform is built on the **Klevro Light-Mode Educational Theme**:
1. **Vibrant & Meticulous Light Mode**: An inviting, clean atmosphere built on `#F8FAFC` slate mesh backgrounds, elevated pure-white surfaces, and luminous indigo/violet accents.
2. **Dynamic Gamification**: Visual rewards (stars, XP badges, progress bars, confetti, and celebratory glows) that motivate students and make learning interactive.
3. **Fluid Micro-Animations**: Smooth transitions, floating badges, subtle scaling on hover (`hover:scale-[1.02]`), and responsive press feedback (`active:scale-[0.98]`).
4. **Uncompromising Polish**: Every card, modal, button, and badge must look premium, modern, and carefully crafted. Simple or rustic MVP-style styling is strictly prohibited.

---

## 2. Visual Style, Colors & Typography

### Primary Brand Accents
- **Indigo Primary**: `#6366F1` (`bg-indigo-600`, `text-indigo-600`) - Used for primary actions, active states, key navigation, and brand highlights.
- **Violet Secondary**: `#8B5CF6` (`bg-violet-500`, `text-violet-600`) - Used in gradients, secondary accents, and interactive highlights.
- **Primary Gradient**: `bg-gradient-to-r from-indigo-600 to-violet-600` (or CSS utility `.premium-gradient-primary`).

### Backgrounds & Surfaces
- **App Ground**: `#F8FAFC` (`bg-slate-50`) with subtle radial mesh glow (`.bg-mesh`).
- **Surface Cards**: Pure White `#FFFFFF` (`bg-white`) with delicate borders (`border-slate-100` or `border-slate-200/80`).
- **Glassmorphism**: `.glass` (`bg-white/80 backdrop-blur-md border border-white/40`) used for sticky headers, floating bars, and overlays.

### Functional & Gamification Colors
- **Success / Mastery (Emerald)**: `#10B981` (`bg-emerald-50`, `text-emerald-600`, `border-emerald-200`) - Used for completed lessons, passed exams, correct answers, and submit buttons.
- **Reward / XP / Stars (Amber)**: `#F59E0B` (`bg-amber-50`, `text-amber-600`, `border-amber-200`) - Used for points, hints, stars, and achievements.
- **Warning / Alert (Rose)**: `#F43F5E` (`bg-rose-50`, `text-rose-600`, `border-rose-200`) - Used for incorrect answers, expired access, and destructive actions.
- **Info / Tips (Sky)**: `#0EA5E9` (`bg-sky-50`, `text-sky-600`, `border-sky-200`) - Used for instructional notes and neutral guidance.

### Typography & RTL Hierarchy
- **Headings & Titles**: `#0F172A` (`text-slate-900`) - Always bold/heavy (`font-black` or `font-extrabold`).
- **Body & Subtitles**: `#334155` (`text-slate-700`) - High readability (`font-bold` or `font-medium`).
- **Captions & Metadata**: `#64748B` (`text-slate-500` or `text-slate-400`) - Used for timestamps, secondary labels, and breadcrumbs.

---

## 3. Frontend Component Standards & Elevators

### Premium Cards (`.premium-card`)
Every content container, course card, exam item, or activity box must follow this pattern:
```tsx
<div className="bg-white rounded-[30px] sm:rounded-[35px] p-6 sm:p-8 border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-indigo-100/50 hover:border-indigo-200/60 transition-all duration-500 group relative overflow-hidden">
  {/* Card Content */}
</div>
```
- **Border Radius**: Always use large, smooth radiuses: `rounded-[24px]` for medium items, `rounded-[30px]` to `rounded-[40px]` for cards/modals. Never use small corners like `rounded-md` or `rounded-lg` for main cards.
- **Shadows**: Subtle default shadow (`shadow-sm` or `shadow-md`), elevating smoothly on hover (`hover:shadow-xl hover:-translate-y-1`).

### Standardized Buttons
1. **Primary Action Button (Indigo/Violet)**:
   ```tsx
   <button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white px-8 py-4 rounded-2xl font-black text-base shadow-xl shadow-indigo-100 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3">
     <span>ابدأ الآن</span>
   </button>
   ```
2. **Success / Submit Button (Emerald)**:
   ```tsx
   <button className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black text-base shadow-xl shadow-emerald-100 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3">
     <span>تأكيد الإجابة</span>
   </button>
   ```
3. **Secondary / Outline Button**:
   ```tsx
   <button className="bg-white hover:bg-slate-50 text-slate-700 border-2 border-slate-200 hover:border-slate-300 px-6 py-3.5 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 shadow-sm">
     <span>رجوع</span>
   </button>
   ```

### Badges & Pills
```tsx
<span className="px-3 py-1.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center gap-1.5 w-fit">
  <Icon className="w-3.5 h-3.5" />
  <span>شعار بصرى</span>
</span>
```

---

## 4. Key Architectural Data Flows

### A. Modular Course Editor State Propagation
The frontend Course Editor is managed through a centralized state context provider to prevent rendering bottlenecks:
```
[CourseEditorContext.tsx] (Main state, API methods, autosave timers)
         │
         ├─► [CourseSettingsForm.tsx] (Metadata, covers, assigned schools)
         ├─► [LessonList.tsx] (Lessons listing, sorting, and metadata)
         ├─► [ExamList.tsx] (Linking exams & quiz modal configurations)
         └─► [LessonBuilderModal.tsx] (Sub-components: slide grids, assignment editors)
```
- **Form State Sync**: Sub-forms update context state using `setCurrentLesson` or `setCourseData`.
- **Autosave Routine**: Triggers every 60 seconds when `hasUnsavedChanges === true` and the lesson builder modal is closed, saving silently to backend database fields.

### B. Gamification & Streak Backend Engine
When a student submits an answer via `POST /api/progress/lesson/:lessonId/submit-answer`, the backend runs this scoring process:
1. **Double Attempt Protection**: Checks if `XPHistory` already records a successful attempt for the student on this question. If yes, 0 XP is awarded.
2. **First Attempt Correct**: Increments `User.xp` by the question's `xpPoints` and inserts a log in `XPHistory`.
3. **Streak Update**: Tracks consecutive correct answers inside the lesson session. 
4. **Streak Bonuses**: 
   - Reaching a **5-streak** awards a **+10 XP** milestone bonus.
   - Reaching a **10-streak** awards a **+30 XP** milestone bonus.

---

## 5. Development Rules & AI Coding Assistant Constraints

Whenever an AI coding assistant modifies or generates code for this project, it **MUST STRICTLY OBEY** the following directives:

### 🚫 RULE 1: STRICT 1500 LINE CODE FILE LIMIT
- **NO SINGLE CODE FILE CAN EXCEED 1500 LINES.**
- If you edit, add, or refactor a file and it grows beyond **1500 lines**, you **MUST** immediately stop and modularize it.
- Extract hooks, sub-components, contexts, modals, or utility functions into distinct files under appropriate subdirectories.

### 🚫 RULE 2: COMMUNICATE WITH THE USER BEFORE AND DURING WORK
- You **must always outline your implementation plan to the user** before starting.
- Explain the background task progression and what modifications you are performing. Talk in a friendly, professional tone.

### 🚫 RULE 3: DO NOT OVERWRITE LOCAL CODE WITH GITHUB REMOTES
- Always prioritize local workspace files as the ground truth.
- Do not perform checkouts or resets from outdated GitHub remote repositories.
  - **Frontend Repo**: `https://github.com/minasamir1401/course-front`
  - **Backend Repo**: `https://github.com/minasamir1401/course-back`

### 🚫 RULE 4: NO HARDCODED DARK BACKGROUNDS IN LIGHT MODE
- **NEVER** use dark hex colors like `bg-[#1a1a2e]`, `bg-[#0f172a]`, `bg-slate-900`, or pure black as large card backgrounds or section containers on student pages.
- If a high-contrast showcase is required, use gradients (`bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white`) or elegant glassmorphism.

### 🚫 RULE 5: NO FLAT OR UNSTYLED TAILWIND BUTTONS
- **NEVER** use flat unshadowed Tailwind utility buttons (e.g. `bg-blue-500` or `bg-red-500`). Action items must feature Indigo/Violet gradients, Emerald/Rose highlights, appropriate dropshadows (`shadow-xl shadow-indigo-100`), and rounded corners.

### 🚫 RULE 6: PRESERVE CONFETTI & GAMIFICATION JOY
- Always implement celebratory confetti triggers (`react-confetti`) when students successfully pass an exam, finish a lesson, or unlock a milestone streak.

### 🚫 RULE 7: NO PLACEHOLDER CARDS
- Never render blank boxes or placeholder text for "under construction" states. Build elegant showcase cards utilizing glassmorphism badges, icons, and instructional copy.

---

## 6. Complete Project Directory Map & File Descriptions

To make code modification and extension straightforward, refer to this detailed workspace layout:

### 🖥️ Frontend (Next.js Application)
All files are under [frontend/src/](file:///d:/pj/porj/corse/lms-platform/frontend/src/):
*   **App Pages & Layouts (`src/app/`)**:
    *   `src/app/page.tsx`: Home landing page.
    *   `src/app/lessons/[id]/page.tsx`: Student interactive lesson player and slide viewer.
    *   `src/app/courses/[id]/page.tsx`: Student course detail dashboard and syllabus tree.
    *   `src/app/profile/page.tsx`: Student portfolio and XP summary dashboard.
    *   `src/app/reports/page.tsx`: Student analytical KPI charts and reporting page.
    *   `src/app/super-admin/courses/edit/page.tsx`: Super admin course edit lightweight page container.
    *   `src/app/school-admin/courses/edit/page.tsx`: School admin course edit lightweight page container.
*   **Modular Course Editor Components (`src/components/course-editor/`)**:
    *   `CourseEditor.tsx`: Main unified layout component initializing the context provider.
    *   `CourseEditorContext.tsx`: Manages active states, API sync, auto-saving logic, and hooks.
    *   `CourseSettingsForm.tsx`: Cover image uploader, titles, and multi-school assignment checkboxes.
    *   `LessonList.tsx`: Grid showing list of lessons with scheduling, sorting, and deletion commands.
    *   `ExamList.tsx`: Modal portal connecting exams and quizzes.
    *   `LessonBuilderModal.tsx`: The core slide builder, assignments manager, question builder, and Excel sheets parser.
*   **Other Shared UI Components (`src/components/`)**:
    *   `InteractiveQuestionRenderer.tsx`: Renders MCQ, True/False, and Multi-Select choices with instant student feedback.
    *   `GeoGebraWidget.tsx`: Dynamic Math widget embedding mathematical tools into lessons.
*   **State & Providers (`src/contexts/` & `src/context/`)**:
    *   `LanguageContext.tsx`: Multi-language toggle (Arabic / English) and translation helpers.
    *   `NotificationContext.tsx`: Custom beautiful UI toast system.
*   **Helpers & Connection (`src/lib/`)**:
    *   `api.ts`: API endpoints config and backend fetching helpers.
    *   `utils.ts`: Small UI helpers (e.g., getting option letters, date parsing).

### ⚙️ Backend (Express API & Database)
All files are under [backend/src/](file:///d:/pj/porj/corse/lms-platform/backend/src/):
*   **Main Entry (`src/index.ts`)**: Configures Express, CORS policies, global error handling, and mounts all endpoint routers.
*   **API Routers (`src/routes/`)**:
    *   `src/routes/courses.ts`: Courses retrieval and management endpoints.
    *   `src/routes/progress.ts`: Student answer submissions, streak multipliers, and XP aggregates.
    *   `src/routes/exams.ts`: Submitting exams, grading, and creating quizzes.
    *   `src/routes/skillsHub.ts`: Skills clusters, lessons, and interactive activities.
*   **Database Schema (`prisma/schema.prisma`)**:
    *   Defines PostgreSQL tables (User, School, Course, Lesson, Question, XPHistory) and relations.
