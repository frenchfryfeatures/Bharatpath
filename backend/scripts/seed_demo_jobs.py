"""Give the local job board real-looking postings (2026-11-23).

The integration suite writes into the same local database and leaves behind
hundreds of published jobs titled with random letters ("aggkhsmm tnaeudiz")
and one-line descriptions. This rewrites every PUBLISHED job's content --
title, description, skills, location, work mode, experience, salary and the
`details` document -- from a catalogue of real technical and non-technical
roles, so the app can be looked at and demonstrated. Re-run it after a test
run.

**Local only**, like the taxonomy seeders: it refuses any database that is not
on this machine. It never changes a job's status, employer, threshold or
applications, and every document is validated by the same models the API
uses before it is written.

    cd backend && python scripts/seed_demo_jobs.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

LOCAL_HOSTS = ("127.0.0.1", "localhost", "postgres", "::1")

CITIES = ["Pune", "Mumbai", "Bengaluru", "Hyderabad", "Chennai", "Delhi", "Nagpur", "Ahmedabad"]

BENEFITS_OFFICE = [
    "Health insurance for you and your family",
    "Paid leave and public holidays",
    "Provident fund",
    "Learning budget",
]
BENEFITS_FIELD = ["Health insurance", "Travel allowance", "Performance incentive", "Paid leave"]

# Monthly salary in rupees (stored as paise). Experience in months.
ROLES: list[dict[str, Any]] = [
    {
        "title": "Backend Developer (Python)",
        "industry": "IT Services & Consulting",
        "department": "Engineering - Software & QA",
        "category": "Software Development",
        "job_type": "FULL_TIME",
        "mode": "HYBRID",
        "exp": (24, 60),
        "salary": (70000, 120000),
        "education": "GRADUATE",
        "skills": ["Python", "FastAPI", "PostgreSQL", "REST APIs"],
        "nice": ["Docker", "Redis", "AWS"],
        "description": (
            "We are looking for a Backend Developer to build and run the services behind our "
            "customer-facing products. You will design APIs, model data in PostgreSQL and keep "
            "our systems fast and reliable as usage grows.\n\n"
            "You will work in a small product team with a product manager, a designer and two "
            "frontend engineers, owning features from the first design discussion to the "
            "release and the on-call rota that follows. We value clear code, sensible tests and "
            "engineers who ask why before they ask how."
        ),
        "responsibilities": [
            "Design, build and document REST APIs in Python (FastAPI)",
            "Model data and write efficient queries in PostgreSQL",
            "Write unit and integration tests and review teammates' code",
            "Monitor services in production and fix issues quickly",
            "Work with frontend engineers to agree API contracts",
        ],
        "required": [
            "2+ years building backend services in Python",
            "Good understanding of SQL and relational databases",
        ],
        "preferred": ["Experience with Docker and a cloud provider such as AWS"],
    },
    {
        "title": "Frontend Developer (React)",
        "industry": "Software Product",
        "department": "Engineering - Software & QA",
        "category": "Software Development",
        "job_type": "FULL_TIME",
        "mode": "REMOTE",
        "exp": (12, 48),
        "salary": (55000, 95000),
        "education": "GRADUATE",
        "skills": ["React", "TypeScript", "JavaScript", "HTML", "CSS"],
        "nice": ["Next.js", "Tailwind", "Testing Library"],
        "description": (
            "Join our web team to build the screens thousands of small businesses use every "
            "day to manage their orders and customers. You will turn designs into fast, "
            "accessible React interfaces and help shape our component library.\n\n"
            "The role is fully remote within India, with a team meeting in Bengaluru once a "
            "quarter. You will pair with designers early, care about how the product feels on "
            "a slow phone connection, and leave every page a little better than you found it."
        ),
        "responsibilities": [
            "Build responsive, accessible pages in React and TypeScript",
            "Maintain and extend the shared component library",
            "Work with designers to refine interactions before they are built",
            "Improve page load times and Core Web Vitals",
            "Write component and end-to-end tests",
        ],
        "required": [
            "1+ year of professional React development",
            "Strong HTML, CSS and JavaScript",
        ],
        "preferred": ["Experience with Next.js or server-side rendering"],
    },
    {
        "title": "Android Developer",
        "industry": "Internet",
        "department": "Engineering - Software & QA",
        "category": "Mobile Development",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (24, 72),
        "salary": (65000, 115000),
        "education": "GRADUATE",
        "skills": ["Kotlin", "Android", "Jetpack Compose"],
        "nice": ["Firebase", "Coroutines", "Play Store releases"],
        "description": (
            "We are hiring an Android Developer to own our consumer app, used by over two "
            "million people across India. You will build new features in Kotlin and Jetpack "
            "Compose and keep the app quick and stable on low-cost devices.\n\n"
            "You will plan releases with the product team, track crash rates and app "
            "performance, and make careful decisions about what runs on the device and what "
            "runs on the server."
        ),
        "responsibilities": [
            "Build features in Kotlin with Jetpack Compose",
            "Keep crash-free sessions above 99.5% and fix regressions",
            "Optimise memory and battery use on entry-level phones",
            "Manage releases on the Play Store with staged rollouts",
            "Review code and mentor junior developers",
        ],
        "required": ["2+ years of Android development in Kotlin", "Published at least one app"],
        "preferred": ["Experience with offline-first apps"],
    },
    {
        "title": "Data Analyst",
        "industry": "Retail",
        "department": "Data Science & Analytics",
        "category": "Business Intelligence & Analytics",
        "job_type": "FULL_TIME",
        "mode": "HYBRID",
        "exp": (12, 36),
        "salary": (45000, 75000),
        "education": "GRADUATE",
        "skills": ["SQL", "Microsoft Excel", "Power BI"],
        "nice": ["Python", "Statistics"],
        "description": (
            "Our retail chain runs 180 stores across western India, and every week the "
            "category and operations teams decide what to stock, where, and at what price. "
            "As a Data Analyst you will give them the numbers they need to decide well.\n\n"
            "You will build and maintain dashboards, answer questions from store managers and "
            "buyers, and dig into sales data to explain what changed and why. Good analysts "
            "here explain findings in plain language as well as they write SQL."
        ),
        "responsibilities": [
            "Build and maintain Power BI dashboards for sales and inventory",
            "Write SQL to answer business questions from category teams",
            "Track weekly KPIs and explain significant changes",
            "Clean and reconcile data from store systems",
            "Present findings to managers in clear, short reports",
        ],
        "required": ["Strong SQL and Excel", "1+ year in an analytics role"],
        "preferred": ["Experience in retail or FMCG data"],
    },
    {
        "title": "QA Engineer (Manual and Automation)",
        "industry": "IT Services & Consulting",
        "department": "Engineering - Software & QA",
        "category": "Quality Assurance and Testing",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (12, 48),
        "salary": (40000, 70000),
        "education": "GRADUATE",
        "skills": ["Manual Testing", "Selenium", "Test Cases", "JIRA"],
        "nice": ["API Testing", "Postman", "Java"],
        "description": (
            "We test banking-grade web and mobile applications for clients in insurance and "
            "healthcare. As a QA Engineer you will plan test cases, find defects before "
            "customers do, and grow our automated regression suite.\n\n"
            "You will join sprint planning, review requirements for gaps, and work closely "
            "with developers to reproduce and fix issues. Curiosity and attention to detail "
            "matter more to us than any single tool."
        ),
        "responsibilities": [
            "Write and run test cases for web and mobile releases",
            "Automate regression tests with Selenium",
            "Log, track and verify defects in JIRA",
            "Test APIs with Postman",
            "Take part in sprint planning and requirement reviews",
        ],
        "required": ["1+ year of software testing", "Knowledge of the testing life cycle"],
        "preferred": ["Basic Java or Python for automation"],
    },
    {
        "title": "DevOps Engineer",
        "industry": "Software Product",
        "department": "IT & Information Security",
        "category": "DevOps",
        "job_type": "FULL_TIME",
        "mode": "HYBRID",
        "exp": (36, 84),
        "salary": (90000, 160000),
        "education": "GRADUATE",
        "skills": ["AWS", "Docker", "Kubernetes", "Terraform", "Linux"],
        "nice": ["Prometheus", "CI/CD", "Python"],
        "description": (
            "We are looking for a DevOps Engineer to look after the platform our engineers "
            "ship on: AWS infrastructure written in Terraform, containers on Kubernetes, and "
            "the pipelines that take code from a pull request to production.\n\n"
            "You will improve reliability and cost, automate the repetitive, and help every "
            "team understand how their services behave in production."
        ),
        "responsibilities": [
            "Manage AWS infrastructure as code with Terraform",
            "Run and upgrade Kubernetes clusters",
            "Build and maintain CI/CD pipelines",
            "Set up monitoring, alerts and on-call runbooks",
            "Reduce cloud costs without reducing reliability",
        ],
        "required": ["3+ years in DevOps or SRE", "Hands-on AWS and Kubernetes"],
        "preferred": ["Certified Kubernetes Administrator or AWS certification"],
    },
    {
        "title": "UI/UX Designer",
        "industry": "Internet",
        "department": "UX, Design & Architecture",
        "category": "UI/UX Design",
        "job_type": "FULL_TIME",
        "mode": "HYBRID",
        "exp": (24, 60),
        "salary": (60000, 100000),
        "education": "GRADUATE",
        "skills": ["Figma", "UI/UX", "Wireframing", "Prototyping"],
        "nice": ["User Research", "Design Systems"],
        "description": (
            "Design the experience for an app that helps first-time job seekers across India "
            "find work. You will take problems from research to tested prototypes, and work "
            "with engineers until the design is live.\n\n"
            "Many of our users read in Hindi or Marathi and use entry-level phones, so clarity "
            "beats decoration. We want a designer who talks to users often and changes their "
            "mind when the evidence says so."
        ),
        "responsibilities": [
            "Turn user problems into flows, wireframes and prototypes in Figma",
            "Run usability tests and act on what you learn",
            "Maintain and grow our design system",
            "Work with engineers during build and review the result",
        ],
        "required": [
            "2+ years designing mobile or web products",
            "A portfolio showing your process",
        ],
        "preferred": ["Experience designing for multiple languages"],
    },
    {
        "title": "Cloud Support Engineer",
        "industry": "IT Services & Consulting",
        "department": "IT & Information Security",
        "category": "IT Support",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (0, 24),
        "salary": (30000, 50000),
        "education": "GRADUATE",
        "skills": ["Linux", "Networking", "AWS", "Troubleshooting"],
        "nice": ["Shell scripting", "Windows Server"],
        "description": (
            "Start your cloud career supporting enterprise customers who run their systems on "
            "AWS. You will diagnose problems with servers, networks and storage, and resolve "
            "them or route them to the right expert.\n\n"
            "Freshers with a strong grasp of Linux and networking are welcome: you will get "
            "eight weeks of paid training and an AWS certification paid for by us."
        ),
        "responsibilities": [
            "Respond to customer tickets within agreed times",
            "Troubleshoot Linux servers, networking and storage issues",
            "Document fixes in the knowledge base",
            "Escalate complex cases with clear notes",
        ],
        "required": ["B.E./B.Tech, B.Sc or BCA", "Good Linux and networking basics"],
        "preferred": ["AWS Cloud Practitioner certification"],
    },
    {
        "title": "Machine Learning Engineer",
        "industry": "Software Product",
        "department": "Data Science & Analytics",
        "category": "Data Science & Machine Learning",
        "job_type": "FULL_TIME",
        "mode": "HYBRID",
        "exp": (24, 72),
        "salary": (100000, 180000),
        "education": "GRADUATE",
        "skills": ["Python", "Machine Learning", "PyTorch", "SQL"],
        "nice": ["MLOps", "NLP", "AWS"],
        "description": (
            "Build models that read documents in Indian languages and turn them into "
            "structured data our customers can use. You will take models from experiment to "
            "a monitored production service.\n\n"
            "You will work with a small applied-research group and the platform team, and you "
            "will be measured on what works for customers, not on benchmark scores."
        ),
        "responsibilities": [
            "Train and evaluate NLP models on real customer data",
            "Ship models as reliable, monitored services",
            "Build data pipelines for labelling and retraining",
            "Track model quality and drift in production",
        ],
        "required": ["2+ years of applied machine learning", "Strong Python"],
        "preferred": ["Experience with Indian-language NLP"],
    },
    {
        "title": "Accountant",
        "industry": "Manufacturing",
        "department": "Finance & Accounting",
        "category": "Accounting & Taxation",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (24, 60),
        "salary": (30000, 45000),
        "education": "GRADUATE",
        "skills": ["Tally", "GST", "Accounting", "Microsoft Excel"],
        "nice": ["TDS", "SAP"],
        "description": (
            "A growing auto-components manufacturer is looking for an Accountant to keep the "
            "books for its two plants. You will handle day-to-day entries, GST and TDS returns, "
            "and the month-end close.\n\n"
            "You will work with the finance manager and the auditors, and you will be the "
            "first point of contact for vendors with questions about payments."
        ),
        "responsibilities": [
            "Record purchase, sales and expense entries in Tally",
            "Prepare and file monthly GST returns",
            "Calculate and deposit TDS",
            "Reconcile bank statements and vendor accounts",
            "Support statutory and internal audits",
        ],
        "required": ["B.Com or M.Com", "2+ years in accounts with GST filing"],
        "preferred": ["Experience in a manufacturing company"],
    },
    {
        "title": "Sales Executive (Field Sales)",
        "industry": "FMCG",
        "department": "Sales & Business Development",
        "category": "Retail & B2C Sales",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (0, 36),
        "salary": (20000, 32000),
        "education": "CLASS_12",
        "skills": ["Field Sales", "Negotiation", "Communication"],
        "nice": ["Hindi", "Marathi", "Two-wheeler"],
        "description": (
            "Grow our packaged-foods brand in your city by building strong relationships with "
            "retailers and distributors. You will visit shops on a planned route, take "
            "orders, set up displays and find new outlets.\n\n"
            "Freshers with a good attitude are welcome. You will get on-the-job training, a "
            "fixed salary, a monthly incentive and a travel allowance."
        ),
        "responsibilities": [
            "Visit 30-40 retail outlets a day on an assigned beat",
            "Take orders and make sure stock reaches the shelf",
            "Open new outlets in your territory",
            "Report daily sales on the company app",
        ],
        "required": ["12th pass or above", "Own two-wheeler and a valid licence"],
        "preferred": ["Prior FMCG sales experience"],
    },
    {
        "title": "Customer Support Executive",
        "industry": "Internet",
        "department": "Customer Success, Service & Operations",
        "category": "Customer Support",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (0, 24),
        "salary": (18000, 26000),
        "education": "CLASS_12",
        "skills": ["Customer Service", "Communication", "English", "Hindi"],
        "nice": ["CRM", "Typing speed"],
        "description": (
            "Help customers of a leading online grocery service by phone, chat and email. "
            "You will solve order, delivery and refund questions and make sure every customer "
            "leaves the conversation satisfied.\n\n"
            "Rotational shifts with two weekly offs. Freshers welcome; full training provided."
        ),
        "responsibilities": [
            "Handle customer calls, chats and emails",
            "Resolve order and delivery issues in the CRM",
            "Escalate complex cases to the right team",
            "Meet quality and response-time targets",
        ],
        "required": ["12th pass or graduate", "Good spoken English and Hindi"],
        "preferred": ["Any regional language"],
    },
    {
        "title": "HR Executive",
        "industry": "IT Services & Consulting",
        "department": "Human Resources",
        "category": "HR Operations",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (12, 48),
        "salary": (30000, 45000),
        "education": "GRADUATE",
        "skills": ["Recruitment", "Onboarding", "HR Operations", "Microsoft Excel"],
        "nice": ["Payroll", "HRMS"],
        "description": (
            "Support a 400-person technology company through hiring, onboarding and everyday "
            "HR operations. You will coordinate interviews, run joining formalities and keep "
            "employee records accurate.\n\n"
            "You will work with hiring managers across teams and be a friendly first contact "
            "for employees' HR questions."
        ),
        "responsibilities": [
            "Source and screen candidates and schedule interviews",
            "Run onboarding and exit formalities",
            "Maintain employee records in the HRMS",
            "Support payroll inputs and attendance",
            "Organise employee engagement activities",
        ],
        "required": ["MBA/PGDM in HR or a graduate with HR experience", "1+ year in HR"],
        "preferred": ["Experience with an HRMS"],
    },
    {
        "title": "Digital Marketing Executive",
        "industry": "Education",
        "department": "Marketing & Communication",
        "category": "Digital Marketing",
        "job_type": "FULL_TIME",
        "mode": "HYBRID",
        "exp": (12, 36),
        "salary": (30000, 50000),
        "education": "GRADUATE",
        "skills": ["SEO", "Google Ads", "Social Media Marketing", "Content Writing"],
        "nice": ["Google Analytics", "Canva"],
        "description": (
            "Grow enrolments for an online learning platform through search, social and "
            "email. You will plan campaigns, write and test ads, and report on what brought "
            "students in.\n\n"
            "You will have a monthly budget of your own and the freedom to try new channels, "
            "as long as you measure them honestly."
        ),
        "responsibilities": [
            "Plan and run Google and Meta ad campaigns",
            "Improve organic traffic through SEO",
            "Create posts and short videos for social channels",
            "Report weekly on leads, cost and conversions",
        ],
        "required": ["1+ year in digital marketing", "Hands-on Google Ads"],
        "preferred": ["Google Ads or Analytics certification"],
    },
    {
        "title": "Staff Nurse",
        "industry": "Healthcare",
        "department": "Healthcare & Life Sciences",
        "category": "Nursing",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (0, 60),
        "salary": (22000, 38000),
        "education": "DIPLOMA",
        "skills": ["Patient Care", "Nursing", "Medication Administration"],
        "nice": ["ICU experience", "BLS certification"],
        "description": (
            "A 250-bed multi-speciality hospital is hiring Staff Nurses for its medical and "
            "surgical wards. You will provide safe, compassionate care to patients and work "
            "closely with doctors and families.\n\n"
            "Accommodation support is available for staff relocating from outside the city."
        ),
        "responsibilities": [
            "Assess, monitor and record patients' condition",
            "Give medicines and treatments as prescribed",
            "Support doctors during rounds and procedures",
            "Educate patients and families on care after discharge",
        ],
        "required": ["GNM or B.Sc Nursing", "Registered with the State Nursing Council"],
        "preferred": ["BLS certification"],
    },
    {
        "title": "Electrician (Maintenance)",
        "industry": "Manufacturing",
        "department": "Production, Manufacturing & Engineering",
        "category": "Maintenance",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (12, 60),
        "salary": (18000, 28000),
        "education": "DIPLOMA",
        "skills": ["Electrical Maintenance", "PLC", "Wiring", "Safety"],
        "nice": ["Panel wiring", "Motors"],
        "description": (
            "Keep a busy packaging plant running by maintaining its electrical systems. You "
            "will carry out preventive maintenance, fix breakdowns quickly and keep records "
            "of every job.\n\n"
            "Shift work with overtime pay. Canteen and transport provided."
        ),
        "responsibilities": [
            "Carry out preventive maintenance on motors, panels and lighting",
            "Diagnose and repair electrical breakdowns",
            "Follow lock-out and safety procedures at all times",
            "Keep maintenance logs up to date",
        ],
        "required": ["ITI or Diploma in Electrical", "Valid wireman licence"],
        "preferred": ["Basic PLC knowledge"],
    },
    {
        "title": "Delivery Associate",
        "industry": "Logistics",
        "department": "Customer Success, Service & Operations",
        "category": "Delivery",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (0, 24),
        "salary": (18000, 25000),
        "education": "CLASS_10",
        "skills": ["Two-wheeler", "Navigation", "Customer Service"],
        "nice": ["Local area knowledge"],
        "description": (
            "Deliver parcels to homes and businesses in your area for a national courier "
            "network. You will collect packages from the hub each morning, plan your route "
            "and deliver on time.\n\n"
            "Weekly pay, fuel allowance and insurance. Flexible shifts available."
        ),
        "responsibilities": [
            "Collect and check parcels at the hub",
            "Deliver on time and collect payment where needed",
            "Update each delivery in the app",
            "Handle customer questions politely",
        ],
        "required": ["10th pass", "Own two-wheeler, licence and smartphone"],
        "preferred": ["Knowledge of local areas"],
    },
    {
        "title": "Content Writer",
        "industry": "Media & Publishing",
        "department": "Content, Editorial & Journalism",
        "category": "Content Writing",
        "job_type": "FULL_TIME",
        "mode": "REMOTE",
        "exp": (12, 48),
        "salary": (30000, 50000),
        "education": "GRADUATE",
        "skills": ["Content Writing", "SEO", "English", "Editing"],
        "nice": ["Hindi writing", "WordPress"],
        "description": (
            "Write clear, useful articles on careers and personal growth for a website read "
            "by two million people a month. You will research topics, interview experts and "
            "publish well-edited pieces every week.\n\n"
            "Fully remote. We care about accuracy, plain language and pieces that actually "
            "help the reader."
        ),
        "responsibilities": [
            "Write 4-6 researched articles a week",
            "Edit and fact-check your own and colleagues' drafts",
            "Optimise articles for search without hurting readability",
            "Interview experts and quote them accurately",
        ],
        "required": ["1+ year of published writing", "Excellent written English"],
        "preferred": ["Ability to write in Hindi"],
    },
    {
        "title": "Store Manager",
        "industry": "Retail",
        "department": "Sales & Business Development",
        "category": "Retail Operations",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (36, 96),
        "salary": (35000, 55000),
        "education": "GRADUATE",
        "skills": ["Store Operations", "Team Management", "Inventory Management", "Sales"],
        "nice": ["Visual merchandising", "POS systems"],
        "description": (
            "Run one of our apparel stores and its team of twelve. You will own the store's "
            "sales targets, customer experience, stock and staff rosters.\n\n"
            "We promote store managers to area roles, and most of our area managers started "
            "on a shop floor."
        ),
        "responsibilities": [
            "Meet monthly sales and margin targets",
            "Hire, train and roster the store team",
            "Control stock, shrinkage and replenishment",
            "Keep the store neat and on-brand every day",
        ],
        "required": ["3+ years in retail, 1+ year leading a team", "Graduate in any discipline"],
        "preferred": ["Fashion or lifestyle retail experience"],
    },
    {
        "title": "Graphic Designer",
        "industry": "Advertising & Marketing",
        "department": "Marketing & Communication",
        "category": "Graphic Design",
        "job_type": "FULL_TIME",
        "mode": "HYBRID",
        "exp": (12, 48),
        "salary": (28000, 50000),
        "education": "GRADUATE",
        "skills": ["Adobe Photoshop", "Adobe Illustrator", "Canva", "Branding"],
        "nice": ["Motion graphics", "Figma"],
        "description": (
            "Create social posts, campaign creatives and print material for brands in food, "
            "fashion and education. You will take a brief, explore ideas and deliver polished "
            "designs on deadline.\n\n"
            "You will work with copywriters and account managers and present your work to "
            "clients now and then."
        ),
        "responsibilities": [
            "Design social media creatives and ad banners",
            "Create print material such as brochures and standees",
            "Follow and extend clients' brand guidelines",
            "Prepare files correctly for print and digital",
        ],
        "required": ["A portfolio of recent work", "Strong Photoshop and Illustrator"],
        "preferred": ["Basic motion graphics"],
    },
    {
        "title": "Business Development Executive",
        "industry": "Software Product",
        "department": "Sales & Business Development",
        "category": "Enterprise & B2B Sales",
        "job_type": "FULL_TIME",
        "mode": "HYBRID",
        "exp": (12, 48),
        "salary": (35000, 60000),
        "education": "GRADUATE",
        "skills": ["Lead Generation", "B2B Sales", "CRM", "Communication"],
        "nice": ["SaaS sales", "LinkedIn Sales Navigator"],
        "description": (
            "Find and win new customers for our billing software for small businesses. You "
            "will reach out to prospects, run product demos and close deals with the support "
            "of a pre-sales team.\n\n"
            "Fixed salary plus an uncapped monthly incentive."
        ),
        "responsibilities": [
            "Generate leads through calls, email and LinkedIn",
            "Run online product demos",
            "Manage your pipeline in the CRM",
            "Negotiate and close deals",
        ],
        "required": ["1+ year in B2B sales", "Confident spoken English"],
        "preferred": ["SaaS sales experience"],
    },
    {
        "title": "Operations Executive",
        "industry": "Logistics",
        "department": "Customer Success, Service & Operations",
        "category": "Operations",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (12, 36),
        "salary": (25000, 38000),
        "education": "GRADUATE",
        "skills": ["Operations", "Microsoft Excel", "Coordination", "MIS Reporting"],
        "nice": ["Warehouse management", "SAP"],
        "description": (
            "Keep a regional warehouse running smoothly. You will coordinate inbound and "
            "outbound shipments, track stock and prepare daily MIS reports for management.\n\n"
            "You will be the link between the warehouse floor, transporters and the sales "
            "team, so clear communication matters as much as Excel."
        ),
        "responsibilities": [
            "Plan daily dispatches with transporters",
            "Track stock and investigate mismatches",
            "Prepare daily and weekly MIS reports",
            "Coordinate with sales on urgent orders",
        ],
        "required": ["Graduate in any discipline", "Good Excel skills"],
        "preferred": ["Warehouse or supply chain experience"],
    },
    {
        "title": "Teacher (Mathematics, Secondary)",
        "industry": "Education",
        "department": "Teaching & Training",
        "category": "School Teaching",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (12, 72),
        "salary": (30000, 48000),
        "education": "POST_GRADUATE",
        "skills": ["Teaching", "Mathematics", "Lesson Planning", "Classroom Management"],
        "nice": ["Smart class tools"],
        "description": (
            "A CBSE school is looking for a Mathematics teacher for classes 8 to 10. You will "
            "plan engaging lessons, assess students fairly and help each child build "
            "confidence in the subject.\n\n"
            "You will work with a supportive department and meet parents at regular "
            "progress meetings."
        ),
        "responsibilities": [
            "Plan and deliver lessons for classes 8-10",
            "Set and mark tests and assignments",
            "Give extra support to students who need it",
            "Meet parents to discuss progress",
        ],
        "required": ["M.Sc/B.Sc in Mathematics with B.Ed", "1+ year teaching secondary classes"],
        "preferred": ["CBSE experience"],
    },
    {
        "title": "Pharmacist",
        "industry": "Healthcare",
        "department": "Healthcare & Life Sciences",
        "category": "Pharmacy",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (0, 48),
        "salary": (20000, 32000),
        "education": "DIPLOMA",
        "skills": ["Pharmacy", "Dispensing", "Inventory Management", "Customer Service"],
        "nice": ["Pharmacy software"],
        "description": (
            "Run the counter at one of our neighbourhood pharmacies. You will dispense "
            "prescriptions accurately, advise customers on correct use, and keep stock and "
            "records in order.\n\n"
            "Rotational shifts; freshers with a valid registration are welcome."
        ),
        "responsibilities": [
            "Check and dispense prescriptions accurately",
            "Advise customers on dosage and storage",
            "Manage stock, expiry and reorders",
            "Keep statutory records up to date",
        ],
        "required": ["D.Pharm or B.Pharm", "Registered pharmacist"],
        "preferred": ["Retail pharmacy experience"],
    },
    {
        "title": "Graduate Trainee (Operations)",
        "industry": "Manufacturing",
        "department": "Production, Manufacturing & Engineering",
        "category": "Production & Operations",
        "job_type": "INTERNSHIP",
        "mode": "ONSITE",
        "exp": (0, 12),
        "salary": (15000, 20000),
        "education": "GRADUATE",
        "skills": ["Communication", "Microsoft Excel", "Problem Solving"],
        "nice": ["Lean manufacturing"],
        "description": (
            "A twelve-month paid traineeship for fresh graduates who want a career in "
            "manufacturing operations. You will rotate through production, quality and supply "
            "chain, learning how a modern plant works.\n\n"
            "Trainees who do well are offered a permanent role at the end of the programme."
        ),
        "responsibilities": [
            "Work on improvement projects in each department",
            "Collect and analyse shop-floor data",
            "Support supervisors with daily planning",
            "Present your project results to the plant head",
        ],
        "required": ["Graduate in engineering, science or commerce (2025 or 2026 batch)"],
        "preferred": ["Interest in manufacturing and process improvement"],
    },
    {
        "title": "Telecaller (Hindi and English)",
        "industry": "Education",
        "department": "Sales & Business Development",
        "category": "Telesales",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (0, 24),
        "salary": (15000, 22000),
        "education": "CLASS_12",
        "skills": ["Telecalling", "Communication", "Hindi", "English"],
        "nice": ["CRM"],
        "description": (
            "Call students who have shown interest in our courses, understand what they "
            "need and help them choose the right programme. Every call is warm; no cold "
            "calling.\n\n"
            "Fixed salary plus incentives for every enrolment. Day shift, Sunday off."
        ),
        "responsibilities": [
            "Call interested students and answer their questions",
            "Explain courses, fees and schedules clearly",
            "Follow up and update every lead in the CRM",
            "Meet daily calling and weekly enrolment targets",
        ],
        "required": ["12th pass or above", "Clear spoken Hindi and English"],
        "preferred": ["Prior telecalling experience"],
    },
    {
        "title": "Chef de Partie",
        "industry": "Hospitality",
        "department": "Food, Beverage & Hospitality",
        "category": "Kitchen",
        "job_type": "FULL_TIME",
        "mode": "ONSITE",
        "exp": (36, 96),
        "salary": (30000, 45000),
        "education": "DIPLOMA",
        "skills": ["Cooking", "Indian Cuisine", "Kitchen Management", "Food Safety"],
        "nice": ["Continental cuisine"],
        "description": (
            "Run the Indian section of a busy hotel kitchen. You will prepare dishes to the "
            "standard and the timing the restaurant expects, train commis chefs and keep the "
            "section clean and safe.\n\n"
            "Meals on duty, uniform and accommodation support provided."
        ),
        "responsibilities": [
            "Prepare and plate dishes for your section",
            "Train and supervise commis chefs",
            "Order and rotate stock to keep waste low",
            "Follow food safety and hygiene standards",
        ],
        "required": ["Diploma in hotel management or culinary arts", "3+ years in a hotel kitchen"],
        "preferred": ["Tandoor experience"],
    },
]


def _details(role: dict[str, Any]) -> dict[str, Any]:
    from app.modules.jobs.details import JobDetails

    office = role["mode"] != "ONSITE" or role["education"] in ("GRADUATE", "POST_GRADUATE")
    doc = {
        "basics": {
            "job_type": role["job_type"],
            "employment_type": "PERMANENT" if role["job_type"] != "INTERNSHIP" else "TEMPORARY",
            "department": role["department"],
            "category": role["category"],
            "industry": role["industry"],
            "openings": 2,
        },
        "compensation": {
            "experience_max_months": role["exp"][1],
            "period": "MONTHLY",
            "salary_type": "FIXED",
            "disclosed": True,
            "negotiable": role["exp"][1] >= 60,
        },
        "content": {
            "responsibilities": role["responsibilities"],
            "required_qualifications": role["required"],
            "preferred_qualifications": role["preferred"],
            "nice_to_have_skills": role["nice"],
            "benefits": BENEFITS_OFFICE if office else BENEFITS_FIELD,
        },
        "skills": {"primary": role["skills"][0]},
        "education": {"minimum": role["education"]},
        "requirements": {"languages": ["English", "Hindi"], "notice_period": "30_DAYS"},
    }
    JobDetails.model_validate(doc)  # the API's own model: refuse a bad document here
    return doc


async def main() -> None:
    from app.core.db import connect_args_for
    from app.modules.jobs.details import JobDetails, check_against_columns
    from app.settings import get_settings

    settings = get_settings()
    url = str(settings.database_url_migrator or "")
    if not url or make_url(url).host not in LOCAL_HOSTS:
        raise SystemExit("Local databases only: set DATABASE_URL_MIGRATOR to this machine.")
    for role in ROLES:  # validate the whole catalogue before touching anything
        error = check_against_columns(
            JobDetails.model_validate(_details(role)),
            skills=role["skills"],
            experience_min_months=role["exp"][0],
        )
        if error:
            raise SystemExit(f"{role['title']}: {error}")

    engine = create_async_engine(url, connect_args=connect_args_for(url))
    try:
        async with async_sessionmaker(engine)() as session, session.begin():
            ids = (
                (
                    await session.execute(
                        text(
                            "SELECT id FROM jobs WHERE status = 'PUBLISHED' "
                            "ORDER BY published_at DESC, id"
                        )
                    )
                )
                .scalars()
                .all()
            )
            for index, job_id in enumerate(ids):
                role = ROLES[index % len(ROLES)]
                city = CITIES[(index // len(ROLES) + index) % len(CITIES)]
                await session.execute(
                    text(
                        "UPDATE jobs SET title = :title, description = :description, "
                        "skills = CAST(:skills AS jsonb), location = :location, "
                        "work_mode = :mode, experience_min_months = :exp_min, "
                        "salary_min_minor = :salary_min, salary_max_minor = :salary_max, "
                        "details = CAST(:details AS jsonb) WHERE id = :id"
                    ),
                    {
                        "id": job_id,
                        "title": role["title"],
                        "description": role["description"],
                        "skills": json.dumps(role["skills"]),
                        "location": "Remote (India)" if role["mode"] == "REMOTE" else city,
                        "mode": role["mode"],
                        "exp_min": role["exp"][0],
                        "salary_min": role["salary"][0] * 100,
                        "salary_max": role["salary"][1] * 100,
                        "details": json.dumps(_details(role)),
                    },
                )
        print(f"Rewrote {len(ids)} published jobs from {len(ROLES)} real roles.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    # Direct script execution puts scripts/, rather than backend/, on sys.path.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    asyncio.run(main())
