import type { CareerField } from '@/services/api/career';

const questions: Record<string, string> = {
  work_status: "Let's start with your work experience. Are you a fresher or do you have experience?",
  currently_employed: "Are you working right now?",
  experience_years: "How many full years of work experience do you have?",
  experience_months: "And how many additional months?",
  company_name: "Which company do you work for?",
  job_title: "What is your current job title?",
  employment_start: "When did you start this job?",
  annual_salary: "What is your current annual salary in rupees?",
  notice_period: "How soon can you join a new job?",
  key_skills: "What are your key skills? You can separate them with commas.",
  industry: "Which industry do you work in?",
  department: "Which department do you work in?",
  role_category: "Which category best describes your role?",
  job_role: "What is your job role?",
  highest_qualification: "Let's talk about your education. What is your highest qualification?",
  course: "Which course are you studying or have you completed?",
  course_type: "How are you pursuing your course?",
  specialization: "What is your specialization?",
  specialization_name: "What is the name of your specialization?",
  institution: "Which university or institute do you attend or did you graduate from?",
  starting_year: "In which year did you start your course?",
  passing_year: "In which year did you graduate, or expect to graduate?",
  headline: "How would you introduce yourself to employers in one short headline?",
  preferred_locations: "Where would you like to work? You can add up to five locations.",
  preferred_salary: "What annual salary are you looking for, in rupees?",
  gender: "Would you like to share your gender? This is optional.",
};

export function conversationQuestion(field?: CareerField): string {
  if (!field) return "Ready to continue to the next step?";
  return (
    questions[field.key] ??
    (field.label.endsWith('?')
      ? field.label
      : `Tell me your ${field.label.toLowerCase()}.`)
  );
}

export interface ConversationAnswer {
  key: string;
  step: number;
  questionIndex: number;
  question: string;
  answer: string;
}
