"""Seed bt.kb_documents with therapist profile content from the Brighter Tomorrow team.

WHY: Chat KB queries like "who specializes in trauma?" or "tell me about Christie Johnson"
currently return nothing because therapist bios live only in the web/ tree, which the ai
container does not ship. This module bakes extracted therapist data in as Python literals
(no web/ dependency at runtime) and upserts one Doc per therapist with a fresh embedding.

Sources:
  web/src/content/team/*.json — 13 therapist profile JSON files (public marketing bios)

PHI: none. These are public-facing marketing bios — safe to embed and store as plaintext
on the local Postgres instance.

Re-runnable: each row is keyed by source_hash so re-running upserts in place.
"""
from __future__ import annotations

import hashlib
import logging
import os
import sys
from dataclasses import dataclass

from openai import OpenAI

from ..core.db import conn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
URL_PREFIX = "curated://bt/team"

# ---------------------------------------------------------------------------
# Therapist data — extracted from web/src/content/team/*.json at authoring
# time. The ai container does NOT ship the web/ tree, so we bake these in.
# Fields present in all entries: slug, full_name, credentials_suffix, role,
# bio_paragraphs, qualifications, education, modalities, who_i_help,
# approach_intro, philosophy_paragraphs.
# Missing / null / empty-list values are handled in _build_content().
# ---------------------------------------------------------------------------

THERAPISTS: list[dict] = [
    {
        "slug": "alayna-hammond",
        "full_name": "Alayna Hammond",
        "credentials_suffix": "CPC-I",
        "role": "Clinical Professional Counselor, Intern",
        "bio_paragraphs": [
            "As a Clinical Professional Counselor Intern, I focus on working with adults and young"
            " people (ages 7+), especially those in the queer and BIPOC communities, who are"
            " navigating mental health challenges such as Borderline Personality Disorder (BPD),"
            " anxiety, depression, and suicidal ideation. With a background in the U.S. Air Force,"
            " I bring both groundedness and empathy to every session.",
            "Using CBT, DBT, and client-centered counseling, Alayna helps clients build emotional"
            " resilience, improve self-understanding, and develop healthy coping strategies. Her"
            " work is rooted in compassion, respect, and authenticity.",
        ],
        "qualifications": [
            "Clinical Professional Counselor, Intern (CPC-I)",
            "Bachelor of Science in Psychology from Delaware State University",
            "Master's in Clinical Mental Health Counseling and School Counseling from Walden"
            " University",
            "U.S. Air Force service background",
        ],
        "education": [
            "Bachelor of Science in Psychology from Delaware State University",
            "Master's in Clinical Mental Health Counseling and School Counseling from Walden"
            " University",
        ],
        "modalities": [
            {
                "name": "Dialectical Behavior Therapy (DBT)",
                "description": "Building skills in emotional regulation, distress tolerance,"
                " mindfulness, and interpersonal effectiveness.",
            },
            {
                "name": "Cognitive Behavioral Therapy (CBT)",
                "description": "Challenging negative thought patterns and developing healthier ways"
                " of thinking.",
            },
            {
                "name": "Trauma-Informed Counseling",
                "description": "Recognizing the impact of past experiences and creating a safe,"
                " non-triggering space to explore them.",
            },
            {
                "name": "Strengths-Based Counseling",
                "description": "Focusing on what's working and helping clients build confidence and"
                " direction.",
            },
            {
                "name": "Affirming and Inclusive Care",
                "description": "Providing culturally sensitive support for queer, BIPOC, and"
                " marginalized individuals.",
            },
        ],
        "who_i_help": [
            "Adults and teens (ages 7+) struggling with anxiety, depression, or mood disorders",
            "Individuals with borderline personality disorder or suicidal ideation seeking"
            " stability and emotional safety",
            "Queer and BIPOC individuals navigating identity, cultural stress, and systemic"
            " challenges",
            "Clients looking for a grounded, affirming, and honest therapist",
            "People who want practical tools paired with real conversations and compassion",
        ],
        "approach_intro": (
            "Therapy doesn't have to be stiff or clinical—it should feel like real conversations,"
            " in a safe space, with someone who sees your whole self. Alayna uses a mix of"
            " evidence-based tools and genuine human connection to help clients build emotional"
            " balance, healthier coping skills, and renewed self-worth."
        ),
        "philosophy_paragraphs": [
            "Therapy doesn't have to feel intimidating or clinical—it can be a place to breathe,"
            " reflect, and reconnect with your sense of self.",
        ],
    },
    {
        "slug": "alexzandria-summers",
        "full_name": "Alexzandria Summers",
        "credentials_suffix": "CSW-I",
        "role": "Clinical Social Work, Intern",
        "bio_paragraphs": [
            "As a Clinical Social Work Intern with a foundation in trauma-informed care,"
            " Alexzandria is passionate about supporting individuals who are often underserved or"
            " navigating difficult systems, including the re-entry population, children in foster"
            " or state care, and individuals and families facing end-of-life transitions.",
            "Alexzandria Summers earned her Master of Social Work from the University of Nevada,"
            " Reno. She has specialized interest in working with re-entry populations, children in"
            " the system, and hospice patients and their families.",
        ],
        "qualifications": [
            "CSW-I (Clinical Social Work-Intern)",
        ],
        "education": [
            "Master of Social Work from the University of Nevada, Reno",
        ],
        "modalities": [
            {
                "name": "Trauma-Informed Care",
                "description": "Creating a safe, supportive space while helping clients process"
                " past experiences and build coping skills.",
            },
            {
                "name": "Cognitive Behavioral Therapy (CBT)",
                "description": "Building skills to identify and shift unhelpful thought patterns"
                " and behaviors.",
            },
            {
                "name": "System Navigation & Advocacy",
                "description": "Helping clients access housing, employment, healthcare, and"
                " community resources.",
            },
            {
                "name": "Life Skills & Goal Setting",
                "description": "Supporting clients in developing practical tools for independence,"
                " stability, and personal growth.",
            },
            {
                "name": "Grief & End-of-Life Support",
                "description": "Providing compassionate care to individuals and families navigating"
                " loss, fear, and transition.",
            },
        ],
        "who_i_help": [
            "Individuals re-entering society who need support with reintegration, stability, and"
            " resources",
            "Children and adolescents in foster care or state systems experiencing trauma or"
            " instability",
            "Individuals and families navigating hospice care, grief, and end-of-life transitions",
            "Clients facing anxiety, life transitions, or system-related stressors",
            "Anyone seeking a compassionate, advocacy-focused therapist",
        ],
        "approach_intro": (
            "Alexzandria uses a trauma-informed, strengths-based approach to support healing and"
            " growth. She tailors her work to each client's unique needs, focusing on empowerment,"
            " resilience, and practical support."
        ),
        "philosophy_paragraphs": [
            "Alexzandria understands that many clients she works with have faced significant"
            " challenges, uncertainty, or barriers to support. She strives to create a space where"
            " clients feel heard, valued, and empowered.",
        ],
    },
    {
        "slug": "christie-johnson",
        "full_name": "Christie Johnson",
        "credentials_suffix": "CPC Intern",
        "role": "Clinical Professional Counselor, Intern",
        "bio_paragraphs": [
            "Christie Johnson is a Clinical Professional Counselor Intern with over 15 years of"
            " experience in social services, specializing in supporting individuals and families"
            " facing substance use, behavioral health challenges, foster care transitions, and"
            " adoption-related issues. She holds a Master's degree in Human Relations from the"
            " University of Oklahoma.",
            "Christie focuses on working with children, teens, young adults, and women, offering a"
            " client-centered, trauma-informed approach. Her work is grounded in evidence-based"
            " practices such as CBT and Motivational Interviewing.",
        ],
        "qualifications": [
            "Clinical Professional Counselor Intern (CPC Intern)",
            "Master's degree in Human Relations from the University of Oklahoma",
            "Over 15 years of experience in social services",
        ],
        "education": [
            "Master's degree in Human Relations from the University of Oklahoma",
        ],
        "modalities": [
            {
                "name": "Cognitive Behavioral Therapy (CBT) & Strengths-Based Therapy",
                "description": "Helping you identify and shift unhelpful thinking patterns to"
                " support emotional well-being.",
            },
            {
                "name": "Trauma-Informed Care",
                "description": "Providing a sensitive, safe space for clients who have experienced"
                " trauma, particularly within family systems.",
            },
            {
                "name": "Motivational Interviewing",
                "description": "Empowering you to tap into your own motivation for positive"
                " change.",
            },
        ],
        "who_i_help": [
            "Children and teens navigating behavioral challenges, emotional struggles, or family"
            " transitions",
            "Young adults facing life transitions, self-esteem issues, or mental health challenges",
            "Women seeking empowerment, healing, and personal growth",
            "Individuals impacted by foster care, adoption, or family reunification",
            "Clients managing substance use or working toward long-term stability",
        ],
        "approach_intro": (
            "Christie believes that every person deserves to be met exactly where they are—without"
            " judgment and with compassion. She combines client-centered, trauma-informed care with"
            " evidence-based practices."
        ),
        "philosophy_paragraphs": [
            "Christie believes that every person deserves to be met exactly where they are—without"
            " judgment and with compassion. She combines client-centered, trauma-informed care with"
            " evidence-based practices to create a healing environment where clients feel seen,"
            " heard, and supported.",
        ],
    },
    {
        "slug": "elisia-danley",
        "full_name": "Elisia Danley",
        "credentials_suffix": "CSW-I",
        "role": "Clinical Social Work, Intern",
        "bio_paragraphs": [
            "As a Clinical Social Work Intern with a strong background in mental health and social"
            " services, Elisia has worked with individuals ages 3 and up, including those"
            " navigating anxiety, depression, neurodivergence, psychosis, and mood disorders. She"
            " creates a welcoming and nonjudgmental space for clients.",
            "Trained in CBT and Art Therapy, and currently receiving training in DBT, Elisia uses"
            " a client-centered, trauma-informed approach. She also draws from Play Therapy"
            " techniques, offering children and teens alternative ways to express and process their"
            " emotions when words aren't enough.",
        ],
        "qualifications": [
            "Clinical Social Work-Intern (CSW-I)",
        ],
        "education": [],  # not provided in source JSON
        "modalities": [
            {
                "name": "Cognitive Behavioral Therapy (CBT) & Strengths-Based Therapy",
                "description": "Helping clients identify and challenge unhelpful thoughts and"
                " behaviors.",
            },
            {
                "name": "Dialectical Behavior Therapy (DBT)",
                "description": "Teaching emotional regulation, distress tolerance, and mindfulness"
                " (currently in training).",
            },
            {
                "name": "Art Therapy",
                "description": "Using creativity as a tool to process emotions and communicate when"
                " words aren't enough.",
            },
            {
                "name": "Play Therapy Techniques",
                "description": "Especially helpful for younger children who may struggle to"
                " express emotions directly.",
            },
        ],
        "who_i_help": [
            "Children and adolescents struggling with anxiety, depression, or emotional regulation",
            "Neurodivergent youth who benefit from expressive and structured support",
            "Young adults navigating identity, stress, and transitions",
            "Clients with difficulty understanding or expressing emotions",
            "Families seeking a supportive and creative therapeutic environment",
        ],
        "approach_intro": (
            "Elisia uses a client-centered, strengths-based approach, blending traditional and"
            " creative therapies to meet clients where they are. Whether through art, play, or"
            " structured interventions, she tailors sessions to support self-expression, resilience,"
            " and emotional balance."
        ),
        "philosophy_paragraphs": [
            "Elisia's role as your therapist is to meet you where you are—with empathy, patience,"
            " and a creative spirit. She strives to create a space that feels safe, relatable, and"
            " engaging—where therapy feels like a place for exploration, discovery, and healing.",
        ],
    },
    {
        "slug": "janelle-thompson",
        "full_name": "Janelle Thompson",
        "credentials_suffix": "CSW-I",
        "role": "Clinical Social Work, Intern",
        "bio_paragraphs": [
            "Janelle Thompson is a Clinical Social Work Intern who specializes in working with"
            " children and teens ages 4 to 15. Her background includes advocacy, crisis support,"
            " and trauma-informed care for young people navigating grief, anxiety, interpersonal"
            " violence, and identity development.",
            "She uses a strengths-based, collaborative approach that combines CBT, DBT, and"
            " creative engagement strategies tailored to each child's developmental needs. Janelle"
            " brings warmth, patience, and cultural humility to every session.",
        ],
        "qualifications": [
            "Clinical Social Work-Intern (CSW-I)",
        ],
        "education": [],  # not provided in source JSON
        "modalities": [
            {
                "name": "Kid and Teen Friendly",
                "description": "Sessions are designed to help young people feel safe, respected,"
                " and at ease.",
            },
            {
                "name": "Emotionally Attuned",
                "description": "Helping your child name, understand, and manage their emotions"
                " without shame.",
            },
            {
                "name": "Strengths-Based",
                "description": "Highlighting what's going well and helping your child build on"
                " their resilience.",
            },
            {
                "name": "Creative and Flexible",
                "description": "Incorporating art, games, and storytelling alongside talk therapy"
                " as needed.",
            },
        ],
        "who_i_help": [
            "Kids and teens ages 4–15 who are struggling with anxiety, depression, or emotional"
            " regulation",
            "Pre-teens dealing with school stress, peer issues, or emotional overwhelm",
            "Youth adjusting to family transitions, divorce, or loss",
            "Kids from diverse cultural or LGBTQ+ families who need affirming support",
        ],
        "approach_intro": (
            "Janelle's work is grounded in trauma-informed care, empowerment theory, and deep"
            " respect for each child's lived experience. She helps kids and teens explore their"
            " feelings, learn healthy coping strategies, and grow into more confident, connected"
            " versions of themselves."
        ),
        "philosophy_paragraphs": [
            "Janelle believes that every child deserves to be seen, heard, and supported as they"
            " grow. Therapy can be a powerful place for young people to make sense of their world,"
            " learn new skills, and feel more confident in themselves.",
        ],
    },
    {
        "slug": "joanne-tran",
        "full_name": "Joanne Tran",
        "credentials_suffix": "LCSW, Team Lead",
        "role": "Licensed Clinical Social Worker, Team Lead",
        "bio_paragraphs": [
            "Joanne Tran is a Licensed Clinical Social Worker, Brainspotting Practitioner, Level 2"
            " Reiki Practitioner, and 200-Hour Certified Yoga Teacher dedicated to helping"
            " individuals heal from emotional wounds and navigate life's challenges with greater"
            " clarity and confidence. She earned her Master's in Social Work from the University of"
            " Nevada, Las Vegas.",
            "Joanne specializes in working with young adults in their 20s and 30s who are"
            " struggling with depression, anxiety, grief, relationship challenges, and major life"
            " transitions. As the daughter of Vietnamese refugees, she is particularly passionate"
            " about supporting Asian American children of immigrants processing intergenerational"
            " trauma and cultural identity conflicts.",
        ],
        "qualifications": [
            "Licensed Clinical Social Work",
            "Brainspotting Practitioner",
            "Level 2 Reiki Practitioner",
            "200-Hour Certified Yoga Teacher",
        ],
        "education": [
            "Master's in Social Work from the University of Nevada, Las Vegas",
        ],
        "modalities": [
            {
                "name": "Brainspotting",
                "description": "A powerful trauma-healing technique that helps process and release"
                " deeply stored emotional pain.",
            },
            {
                "name": "Parts and Memory Therapy",
                "description": "A gentle approach to working with different aspects of self,"
                " allowing for healing at a deeper level.",
            },
            {
                "name": "Trauma-Informed Yoga & Somatic Practices",
                "description": "Using movement, breathwork, and mindfulness to support emotional"
                " regulation and stress relief.",
            },
            {
                "name": "Mindfulness & Meditation",
                "description": "Teaching clients inner awareness, self-compassion, and grounding"
                " techniques for daily life.",
            },
        ],
        "who_i_help": [
            "Struggling with anxiety, depression, and trauma",
            "Facing grief and loss",
            "Navigating major life transitions, such as career changes, breakups, or new life"
            " stages",
            "Experiencing stress and burnout from high-pressure environments",
            "Processing childhood trauma and intergenerational wounds",
            "Seeking alternative healing practices alongside traditional therapy",
        ],
        "approach_intro": (
            "Joanne believes that true healing requires more than just talk therapy—it involves"
            " addressing the mind, body, and spirit as a whole. By blending evidence-based"
            " psychotherapy with mindfulness-based interventions, she creates a compassionate and"
            " empowering space for clients to explore emotions, develop coping strategies, and"
            " foster self-awareness."
        ),
        "philosophy_paragraphs": [
            "Joanne's goal is to provide clients with a supportive and non-judgmental space where"
            " they feel safe to explore their emotions, reconnect with their inner wisdom, and build"
            " resilience.",
        ],
    },
    {
        "slug": "lorenthia-clayton",
        "full_name": "Lorenthia Clayton",
        "credentials_suffix": "CSW-I",
        "role": "Clinical Social Worker, Intern",
        "bio_paragraphs": [
            "Lorenthia Clayton is a Clinical Social Worker committed to helping individuals process"
            " emotions, navigate grief, and build resilience. Originally from Los Angeles, CA, she"
            " earned her Master's Degree in Social Work with honors from the University of Southern"
            " California (USC).",
            "Lorenthia specializes in treating anxiety, depression, grief, and family concerns. She"
            " has a strong passion for supporting bereaved individuals, parents, and youth, guiding"
            " them through complex emotions and challenges that come with loss, identity struggles,"
            " and life transitions.",
        ],
        "qualifications": [
            "Licensed Clinical Social Worker (LCSW)",
            "Master's Degree in Social Work with honors from the University of Southern California"
            " (USC)",
        ],
        "education": [
            "Master's Degree in Social Work with honors from the University of Southern California"
            " (USC)",
        ],
        "modalities": [
            {
                "name": "Cognitive Behavioral Therapy (CBT)",
                "description": "Helping clients shift negative thought patterns and improve"
                " emotional well-being.",
            },
            {
                "name": "Dialectical Behavior Therapy (DBT)",
                "description": "Teaching practical skills for emotional regulation and personal"
                " resilience.",
            },
            {
                "name": "Grief & Bereavement Counseling",
                "description": "Providing a space for clients to process loss and navigate the"
                " emotions surrounding grief.",
            },
            {
                "name": "Family Systems Work",
                "description": "Helping clients improve relationships and break unhealthy"
                " generational patterns.",
            },
            {
                "name": "Trauma-Informed Care",
                "description": "Supporting individuals with past trauma in a way that fosters"
                " healing and self-compassion.",
            },
        ],
        "who_i_help": [
            "Teens and young adults struggling with self-awareness, depression, and family"
            " conflicts",
            "Individuals experiencing grief and loss who need support through life transitions",
            "Parents looking to strengthen their relationships with their children",
            "People facing emotional barriers and seeking clarity and healing",
            "Clients wanting a supportive, non-judgmental space to process emotions and build"
            " self-confidence",
        ],
        "approach_intro": (
            "Lorenthia believes that therapy should be a space for self-exploration, healing, and"
            " personal growth. She integrates a variety of evidence-based and compassionate"
            " approaches to help clients move forward."
        ),
        "philosophy_paragraphs": [
            "Lorenthia is passionate about helping clients gain self-awareness, heal from the past,"
            " and move forward with confidence. She believes that each person has the potential for"
            " growth and transformation.",
        ],
    },
    {
        "slug": "miranda-pulido",
        "full_name": "Miranda Pulido",
        "credentials_suffix": "MFT-I",
        "role": "Marriage and Family Therapist, Intern",
        "bio_paragraphs": [
            "Miranda Pulido is a Marriage and Family Therapy Intern who earned her Master's degree"
            " in Clinical Psychology with an emphasis in Marriage and Family Therapy from Pepperdine"
            " University. She has experience working with individuals, couples, and families across"
            " a variety of mental health concerns.",
            "Miranda is certified in Accelerated Resolution Therapy (ART) and incorporates CBT,"
            " Narrative Therapy, Solution-Focused Therapy, and Internal Family Systems into her"
            " work. She is especially passionate about supporting women, couples, and BIPOC"
            " communities.",
        ],
        "qualifications": [
            "Marriage and Family Therapist-Intern (MFT-I)",
            "Certified in Accelerated Resolution Therapy (ART)",
        ],
        "education": [
            "Master's degree in Clinical Psychology with emphasis in Marriage and Family Therapy"
            " from Pepperdine University",
        ],
        "modalities": [
            {
                "name": "Accelerated Resolution Therapy (ART)",
                "description": "Helping process trauma and distressing memories in a structured,"
                " effective way.",
            },
            {
                "name": "Cognitive Behavioral Therapy (CBT)",
                "description": "Identifying and reframing unhelpful thoughts and behaviors.",
            },
            {
                "name": "Solution-Focused Brief Therapy (SFBT)",
                "description": "Creating practical, goal-oriented steps toward change.",
            },
            {
                "name": "Internal Family Systems (IFS)",
                "description": "Exploring different parts of yourself with compassion and"
                " understanding.",
            },
        ],
        "who_i_help": [
            "Women navigating stress, identity, relationships, or life transitions",
            "Couples seeking to improve communication, connection, and understanding",
            "Individuals and families processing trauma or past experiences",
            "BIPOC clients seeking culturally aware and validating support",
        ],
        "approach_intro": (
            "Miranda believes therapy should feel natural, collaborative, and empowering. Her style"
            " is casual, friendly, and grounded in building real connection. She combines"
            " evidence-based practices with a client-centered approach to help clients gain"
            " insight, heal from past experiences, and move toward the life they want."
        ),
        "philosophy_paragraphs": [
            "Miranda's goal is to create an environment where clients feel safe enough to explore"
            " their experiences openly while also being supported in making meaningful changes.",
        ],
    },
    {
        "slug": "nicole-pangelinan",
        "full_name": "Nicole Pangelinan",
        "credentials_suffix": "CSW-I",
        "role": "Clinical Social Work, Intern",
        "bio_paragraphs": [
            "Nicole Gogue Pangelinan is a Clinical Level Social Work Intern currently pursuing her"
            " Master of Social Work at Syracuse University. She has experience supporting children"
            " and adolescents presenting with complex trauma, anxiety disorders, mood disorders,"
            " behavioral dysregulation, and attachment-related concerns.",
            "Nicole believes therapy should feel safe, collaborative, and empowering. Healing"
            " begins with stability and trust, so she focuses first on helping clients feel"
            " grounded and emotionally safe before exploring deeper experiences. She blends"
            " trauma-informed care with practical skill-building.",
        ],
        "qualifications": [
            "CSW-I (Clinical Social Work-Intern)",
            "Pursuing Master of Social Work at Syracuse University",
        ],
        "education": [
            "Pursuing Master of Social Work at Syracuse University",
        ],
        "modalities": [
            {
                "name": "TF-CBT & CBT-Based Interventions",
                "description": "Helping clients understand the connection between thoughts,"
                " feelings, and behaviors while building healthier coping strategies.",
            },
            {
                "name": "Trauma-Informed Care",
                "description": "Creating a supportive environment that prioritizes safety, trust,"
                " and empowerment.",
            },
            {
                "name": "DBT-Informed Skills",
                "description": "Supporting emotional regulation, distress tolerance, and stronger"
                " interpersonal skills.",
            },
            {
                "name": "Strengths-Based & Relational Focus",
                "description": "Building resilience, identity, and a stronger sense of belonging"
                " through supportive connection.",
            },
        ],
        "who_i_help": [
            "Children, adolescents, and young adults navigating trauma, anxiety, and mood-related"
            " challenges",
            "Youth impacted by foster care involvement, attachment disruptions, or family"
            " instability",
            "Clients struggling with emotional regulation, identity development, or relationship"
            " difficulties",
            "Individuals from minority backgrounds seeking culturally aware and validating"
            " support",
        ],
        "approach_intro": (
            "Nicole is passionate about supporting youth from minority backgrounds or those who"
            " have experienced poverty, single-parent dynamics, foster care involvement, or"
            " disruptions in early relationships. She creates a warm, validating space where"
            " clients feel truly seen, understood, and supported as they build resilience."
        ),
        "philosophy_paragraphs": [
            "Nicole believes therapy should feel safe, collaborative, and empowering—never"
            " intimidating or rushed. Healing begins with stability and trust, so she will focus"
            " first on helping clients feel grounded and emotionally safe before exploring deeper"
            " experiences.",
        ],
    },
    {
        "slug": "samara-cobb",
        "full_name": "Samara Cobb",
        "credentials_suffix": "MSW Student",
        "role": "Master of Social Work (MSW) Student",
        "bio_paragraphs": [
            "Samara Cobb is a second-year Master of Social Work (MSW) student at Eastern"
            " University, with a Bachelor of Science in Psychology from Central Michigan"
            " University. Her professional experience includes work in child welfare and community"
            " services, where she supported individuals and families through investigations, family"
            " preservation efforts, and emergency resource coordination.",
            "Samara is passionate about supporting young adults and adults as they navigate"
            " anxiety, emotional dysregulation, life stressors, and major transitions. She brings a"
            " strong understanding of systemic barriers, family dynamics, and the impact of life"
            " experiences on mental health.",
        ],
        "qualifications": [
            "Master of Social Work (MSW) Student, Eastern University (second-year)",
            "Bachelor of Science in Psychology, Central Michigan University",
            "Professional experience in child welfare and community-based services",
        ],
        "education": [
            "Master of Social Work (MSW) — Eastern University (second-year student)",
            "Bachelor of Science in Psychology — Central Michigan University",
        ],
        "modalities": [
            {
                "name": "Cognitive Behavioral Therapy (CBT) & Strengths-Based Therapy",
                "description": "Helping clients identify patterns in thoughts and behaviors and"
                " develop practical coping strategies.",
            },
            {
                "name": "Dialectical Behavior Therapy (DBT) Skills",
                "description": "Supporting emotional regulation, distress tolerance, and"
                " mindfulness.",
            },
            {
                "name": "Strengths-Based & Trauma-Informed Care",
                "description": "Honoring each client's lived experience while recognizing"
                " resilience and capacity for growth.",
            },
        ],
        "who_i_help": [
            "Young adults and adults navigating anxiety, stress, and life transitions",
            "Individuals seeking a thoughtful, supportive space to process emotions",
            "Clients interested in learning coping skills and building emotional awareness",
            "Those open to individual or group therapy experiences",
            "Clients who value a therapist who listens deeply and collaborates rather than rushes"
            " the process",
        ],
        "approach_intro": (
            "Samara's therapy style centers on empathy, reflection, and skill-building. She is"
            " especially interested in both individual and group therapy, and believes group spaces"
            " can be powerful environments for connection, shared learning, and realizing you are"
            " not alone."
        ),
        "philosophy_paragraphs": [
            "Samara believes healing is not about having all the answers—it's about having a space"
            " where you don't have to carry everything alone. She is committed to walking alongside"
            " clients with curiosity, compassion, and respect.",
        ],
    },
    {
        "slug": "sherrita-williams",
        "full_name": "Sherrita Williams",
        "credentials_suffix": "CSW-I",
        "role": "Clinical Social Worker, Intern",
        "bio_paragraphs": [
            "Sherrita Williams is a Clinical Social Work Intern passionate about helping individuals"
            " and couples improve communication, strengthen relationships, and navigate personal and"
            " emotional challenges. She has experience in case management and behavioral health"
            " co-morbidity, giving her a deep understanding of how mental health and relationships"
            " are closely connected.",
            "Sherrita specializes in working with adults (20+) and married couples who face"
            " communication barriers, emotional struggles, and relationship challenges. She provides"
            " a client-centered, solution-focused approach to therapy.",
        ],
        "qualifications": [
            "Clinical Social Worker, Intern (CSW-I)",
        ],
        "education": [],  # not provided in source JSON
        "modalities": [
            {
                "name": "Client-Centered Therapy",
                "description": "Focusing on each individual's unique strengths and experiences.",
            },
            {
                "name": "EMDR & Brainspotting (in training)",
                "description": "Using evidence-based techniques to heal past emotional wounds.",
            },
            {
                "name": "Marriage & Relationship Counseling",
                "description": "Helping couples work through conflict, reconnect, and improve"
                " communication.",
            },
            {
                "name": "Solution-Focused Therapy",
                "description": "Providing practical tools to navigate challenges with confidence.",
            },
        ],
        "who_i_help": [
            "Adults and married couples facing communication struggles",
            "Individuals navigating major life transitions or relationship challenges",
            "Couples seeking support in strengthening their connection",
            "Clients looking to improve emotional expression and self-awareness",
            "Individuals seeking a safe and supportive space to explore personal growth",
        ],
        "approach_intro": (
            "Sherrita believes that effective communication is the foundation of healthy"
            " relationships—whether in marriage, friendships, or personal growth. She utilizes a"
            " blend of traditional and innovative therapy techniques to help clients develop"
            " stronger emotional awareness and communication skills."
        ),
        "philosophy_paragraphs": [
            "Sherrita is committed to helping clients feel heard, valued, and understood. She"
            " believes that therapy should be a place where individuals and couples can freely"
            " express themselves, gain new perspectives, and develop tools for lasting emotional"
            " well-being.",
        ],
    },
    {
        "slug": "tony-martinez",
        "full_name": "Dr. Tony Martinez",
        "credentials_suffix": "Ph.D., LMFT",
        "role": "Licensed Marriage and Family Therapist",
        "bio_paragraphs": [
            "Dr. Tony Martinez is a Licensed Marriage and Family Therapist with a Ph.D. in"
            " Clinical Psychology from Pacifica Graduate Institute. He has been practicing since"
            " 2007 and brings over 15 years of clinical experience to his work with individuals,"
            " couples, and families. A veteran of the U.S. Air Force, Dr. Martinez's approach is"
            " grounded in real-life perspective, multicultural awareness, and psychodynamic theory.",
            "Dr. Martinez specializes in helping clients explore and heal deep-rooted emotional"
            " patterns related to trauma, anxiety, depression, identity, and relationships. Outside"
            " of private practice, he has taught university-level psychology and continues to"
            " volunteer with underserved communities.",
        ],
        "qualifications": [
            "Ph.D. in Clinical Psychology from Pacifica Graduate Institute",
            "Licensed Marriage and Family Therapist (LMFT)",
            "U.S. Air Force veteran",
            "Practicing since 2007 — over 15 years of clinical experience",
            "University-level psychology instructor",
        ],
        "education": [
            "Ph.D. in Clinical Psychology from Pacifica Graduate Institute",
        ],
        "modalities": [
            {
                "name": "Collaborative and Reflective",
                "description": "Working together to understand your story and create meaningful"
                " goals.",
            },
            {
                "name": "Holistic and Practical",
                "description": "Looking at the full picture: emotional health, daily habits,"
                " boundaries, relationships, and for some, spiritual well-being.",
            },
            {
                "name": "Culturally Grounded",
                "description": "With a multicultural background and international life experience,"
                " honoring identity, culture, and lived experience.",
            },
            {
                "name": "Trauma-Informed",
                "description": "Meeting clients with care and clinical expertise whether they have"
                " experienced combat trauma, childhood adversity, or emotional wounds.",
            },
        ],
        "who_i_help": [
            "Adults and couples feeling stuck in painful emotional or relational patterns",
            "Veterans and first responders coping with trauma and adjustment challenges",
            "Clients facing depression, anxiety, or identity crises",
            "Individuals seeking a deeper understanding of themselves and their relationships",
            "Clients from diverse cultural backgrounds looking for a therapist who understands"
            " lived experience",
        ],
        "approach_intro": (
            "Dr. Martinez uses a psychodynamic approach, helping clients understand how past"
            " experiences shape current patterns, emotions, and relationships. The focus is on"
            " exploring how those experiences influence your sense of self—and how to break free"
            " from what's holding you back."
        ),
        "philosophy_paragraphs": [
            "You are capable of more than you believe—and therapy can be the place where you start"
            " to believe it too. Dr. Martinez's mission is to help clients discover their strength,"
            " understand their story, and begin building the life they want, one session at a time.",
        ],
    },
    {
        "slug": "yvette-howard",
        "full_name": "Yvette Howard",
        "credentials_suffix": "LCSW",
        "role": "Founder & Licensed Clinical Social Worker",
        # Note: Yvette is not currently accepting new clients; her profile describes her
        # role as CEO/Founder supporting the Brighter Tomorrow team.
        "bio_paragraphs": [
            "Yvette Howard, LCSW, is the CEO and Founder of Brighter Tomorrow Therapy. As a"
            " dedicated mental health therapist, her purpose is to guide individuals on their"
            " journey toward self-discovery and empowerment.",
            "Yvette is currently not accepting new clients, as her mission is dedicated to"
            " assisting and leading the Brighter Tomorrow team. She specializes in helping clients"
            " break through barriers, silence the inner critic, and embrace their unique path. Her"
            " approach is rooted in compassion, empathy, and understanding.",
        ],
        "qualifications": [
            "Licensed Clinical Social Worker (LCSW)",
            "CEO & Founder, Brighter Tomorrow Counseling",
        ],
        "education": [],  # not provided in source JSON
        "modalities": [],  # not provided in source JSON
        "who_i_help": [],  # not provided in source JSON — currently not accepting new clients
        "approach_intro": None,
        "philosophy_paragraphs": [],
    },
]


# ---------------------------------------------------------------------------
# Doc dataclass — mirrors seed_curated_kb.py exactly
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Doc:
    slug: str
    title: str
    section: str
    content: str

    @property
    def url(self) -> str:
        return f"{URL_PREFIX}/{self.slug}"

    @property
    def source_hash(self) -> str:
        return hashlib.sha256(
            f"{self.url}\n{self.title}\n{self.section}\n{self.content}".encode("utf-8")
        ).hexdigest()


# ---------------------------------------------------------------------------
# Content assembly
# ---------------------------------------------------------------------------

_MAX_CONTENT_CHARS = 1500


def _build_title(t: dict) -> str:
    """Assemble the retrieval-friendly title for a therapist dict."""
    name = t["full_name"]
    creds = t.get("credentials_suffix") or ""
    role = t.get("role") or ""
    title = f"Therapist: {name}"
    if creds:
        title += f", {creds}"
    if role:
        title += f" — {role}"
    return title


def _build_content(t: dict) -> str:
    """
    Assemble a clean, readable plaintext blob from extracted therapist fields.
    Stays under _MAX_CONTENT_CHARS by progressively dropping the least-informative
    content: second bio paragraph first, then extra modality lines, then extra
    qualifications, until under budget.
    """
    name = t["full_name"]
    creds = t.get("credentials_suffix") or ""
    role = t.get("role") or ""

    # Header line
    header = name
    if creds:
        header += f", {creds}"
    if role:
        header += f" — {role}"
    header += " at Brighter Tomorrow Therapy."

    who = t.get("who_i_help") or []
    modalities = t.get("modalities") or []
    bios = t.get("bio_paragraphs") or []
    quals = t.get("qualifications") or []
    edu = t.get("education") or []
    edu_set = set(edu)
    extra_quals = [q for q in quals if q not in edu_set]

    def _assemble(
        who_items: list,
        mod_items: list,
        bio_items: list,
        edu_items: list,
        qual_items: list,
    ) -> str:
        parts: list[str] = [header]
        if who_items:
            parts.append("\nWho they help:")
            parts.extend(f"  - {item}" for item in who_items)
        if mod_items:
            parts.append("\nSpecialties & approach:")
            parts.extend(f"  - {m['name']}: {m['description']}" for m in mod_items)
        if bio_items:
            parts.append("\n" + "\n\n".join(bio_items))
        if edu_items or qual_items:
            parts.append("\nBackground:")
            parts.extend(f"  - {e}" for e in edu_items)
            parts.extend(f"  - {q}" for q in qual_items)
        return "\n".join(parts)

    # Start with full content, then progressively shed to meet the budget.
    # Trim order (least-informative last):
    #   1. Drop second bio paragraph
    #   2. Drop extra qualifications (already covered by education)
    #   3. Drop modalities beyond the first 3
    #   4. Drop modalities beyond the first 2
    #   5. Drop who_i_help beyond the first 3 lines
    candidates = [
        (bios[:2], modalities, edu, extra_quals),
        (bios[:1], modalities, edu, extra_quals),
        (bios[:1], modalities, edu, []),
        (bios[:1], modalities[:3], edu, []),
        (bios[:1], modalities[:2], edu, []),
        (bios[:1], modalities[:2], edu[:2], []),
    ]

    for bio_sel, mod_sel, edu_sel, qual_sel in candidates:
        content = _assemble(who, mod_sel, bio_sel, edu_sel, qual_sel)
        if len(content) <= _MAX_CONTENT_CHARS:
            return content

    # Absolute fallback: header + first bio only
    return _assemble([], [], bios[:1], [], [])


def _build_docs() -> tuple[Doc, ...]:
    docs = []
    for t in THERAPISTS:
        docs.append(
            Doc(
                slug=f"team-{t['slug']}",
                title=_build_title(t),
                section="therapists",
                content=_build_content(t),
            )
        )
    return tuple(docs)


DOCS: tuple[Doc, ...] = _build_docs()


# ---------------------------------------------------------------------------
# Embedding helpers — mirrors seed_curated_kb.py
# ---------------------------------------------------------------------------


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


# ---------------------------------------------------------------------------
# Seed entrypoint
# ---------------------------------------------------------------------------


def seed_team_kb() -> int:
    """Embed all therapist docs and upsert into bt.kb_documents. Returns count."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.error("OPENAI_API_KEY not set")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    texts = [f"{d.title}\n{d.section}\n{d.content}" for d in DOCS]
    logger.info(
        "Embedding %d therapist KB documents using %s", len(DOCS), EMBED_MODEL
    )
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    vecs = [item.embedding for item in resp.data]

    with conn() as c, c.cursor() as cur:
        for doc, vec in zip(DOCS, vecs):
            cur.execute(
                """
                INSERT INTO bt.kb_documents
                    (url, title, section, chunk_idx, content, token_count, embedding, source_hash)
                VALUES
                    (%s, %s, %s, 0, %s, %s, %s::vector, %s)
                ON CONFLICT (source_hash) DO UPDATE SET
                    url = EXCLUDED.url,
                    title = EXCLUDED.title,
                    section = EXCLUDED.section,
                    content = EXCLUDED.content,
                    token_count = EXCLUDED.token_count,
                    embedding = EXCLUDED.embedding
                """,
                (
                    doc.url,
                    doc.title,
                    doc.section,
                    doc.content,
                    len(doc.content) // 4,  # rough token estimate
                    _vec_literal(vec),
                    doc.source_hash,
                ),
            )
    logger.info("Seeded %d therapist KB documents", len(DOCS))
    return len(DOCS)


if __name__ == "__main__":
    n = seed_team_kb()
    sys.exit(0 if n > 0 else 1)
