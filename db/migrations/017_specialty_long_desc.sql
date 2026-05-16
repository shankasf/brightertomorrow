-- 017_specialty_long_desc.sql
-- Adds long-form descriptions to bt.specialties so the new
-- /specialties/[slug] detail pages have meaningful editorial copy.

ALTER TABLE bt.specialties ADD COLUMN IF NOT EXISTS long_desc text;

UPDATE bt.specialties SET long_desc = $LD$Anxiety has a way of taking up space — racing thoughts, a tight chest, restless sleep, the constant scan for what might go wrong. It can be hard to put into words, and even harder to know when "stressed" tips into something that needs support. You are not making it up, and you do not have to white-knuckle your way through it alone.

Our clinicians work with the full range of anxiety experiences — generalized anxiety, social anxiety, panic, health anxiety, perfectionism, performance worry, and the kind of low-grade dread that quietly steals your weekends. Sessions are warm and collaborative, grounded in approaches like cognitive behavioral therapy, acceptance and commitment therapy, mindfulness, and parts work. We tailor the fit to you — there is no single protocol that fits everyone.

Most clients start to notice small shifts in the first few weeks — a little more room around the worry, a little more ability to pause before reacting, a little more sleep. Over time, therapy helps you understand what your anxiety is trying to protect, build skills that actually hold up under pressure, and reclaim the parts of life that anxiety has narrowed.

We see adults and teens for anxiety care, in-person at our Las Vegas offices or by secure telehealth anywhere in Nevada. Most major Nevada insurance plans are in-network, and sliding-scale options are available when needed.$LD$
WHERE slug = 'anxiety';

UPDATE bt.specialties SET long_desc = $LD$Depression is not just sadness. It is the heaviness of mornings, the loss of interest in things that used to matter, the foggy distance from people who love you, the quiet voice that says you are too much or not enough. Sometimes it arrives after a clear life event, and sometimes it shows up with no obvious reason at all. Both are real, and both are treatable.

Our therapists provide evidence-based care for the full spectrum of depression — from situational low mood and burnout to persistent depressive disorder and postpartum depression. We draw on cognitive behavioral therapy, behavioral activation, acceptance and commitment therapy, parts work, and mindfulness-based approaches, and we pay close attention to the everyday things that make depression louder or quieter — sleep, movement, connection, and meaning.

Therapy for depression is not about pushing through or thinking your way out. It is about slowly rebuilding a life that feels worth showing up for, with a clinician who notices the small wins and stays steady on the harder days. Many clients see meaningful change within the first couple of months, and we will be honest with you about pacing.

We work with adults, teens, and older adults, in-person in Las Vegas or by HIPAA-compliant telehealth across Nevada. If you are in crisis or thinking about harming yourself, please call or text 988 — we are not an emergency service.$LD$
WHERE slug = 'depression';

UPDATE bt.specialties SET long_desc = $LD$Trauma is what happens inside us in response to what happened to us. It can come from a single event — an accident, an assault, a loss — or from years of living in something that should not have been normal. The body remembers, even when the mind has moved on, and that memory can show up as anxiety, numbness, flashbacks, hypervigilance, or the sense that something is wrong but you cannot quite name it.

Our trauma specialists are trained in EMDR (Eye Movement Desensitization and Reprocessing) and Parts and Memory Therapy — two evidence-based approaches that help the nervous system actually process stuck material, not just talk around it. We also draw on internal family systems, somatic awareness, and trauma-focused cognitive behavioral therapy, depending on what fits you best.

Pacing matters. Before we ever turn toward a hard memory, we build a foundation of safety, skills, and trust. You stay in control of what we approach and when. Many clients tell us they have been in talk therapy for years but never felt the work reach the place trauma lives — this is the work designed for that place.

We see adults and teens for PTSD, complex PTSD, childhood trauma, medical trauma, and trauma from interpersonal violence. Available in-person in Las Vegas or via secure telehealth across Nevada.$LD$
WHERE slug = 'trauma-ptsd';

UPDATE bt.specialties SET long_desc = $LD$Therapy should be a place where every part of who you are is welcomed — not tolerated, not "worked around," but actually understood. Our clinicians provide care that is affirming of LGBTQIA+ identities and the lived experience that comes with them, including the joy, the community, and the very real weight of navigating a world that is not always safe or kind.

We support clients across the full spectrum of identity and orientation — coming out at any age, gender identity exploration, transition (social, medical, and otherwise), chosen family dynamics, religious or family-of-origin rupture, minority stress, and the everyday work of building a life that is yours. We also provide letters of support for gender-affirming care when clinically appropriate, following WPATH standards.

You should not have to spend the first several sessions explaining basic vocabulary or defending who you are. Our therapists come to the work informed and humble, and we keep learning. If we are not the right fit, we will tell you honestly and help you find someone who is.

LGBTQIA+ affirming care is offered for adults, teens, couples, and families — in-person in Las Vegas or through HIPAA-compliant telehealth anywhere in Nevada.$LD$
WHERE slug = 'lgbtqia';

UPDATE bt.specialties SET long_desc = $LD$Long-term relationships are not supposed to stay the same — they grow, strain, repair, and grow again. When you and your partner keep landing in the same painful conversation, when intimacy has gone quiet, when trust has been broken, or when life has pulled you in different directions, couples therapy gives you a structured place to do the harder work together.

We draw primarily on the Gottman Method and Emotionally Focused Therapy — two of the most well-researched approaches to couples work. That means we look at communication patterns, repair attempts, the deeper emotional needs underneath your fights, and the attachment story each of you brings into the relationship. We will help you slow down conflict enough to actually understand what is happening between you.

Couples work is not about deciding who is "right." It is about getting unstuck. Many couples start therapy not in crisis but in drift — and the earlier you come in, the more options you have. We also work with couples navigating infidelity, parenting strain, fertility and pregnancy loss, intercultural and interfaith dynamics, sexual concerns, and the decision to repair or part well.

Sessions are typically every week or every other week, in-person in Las Vegas or by secure telehealth across Nevada.$LD$
WHERE slug = 'couples';

UPDATE bt.specialties SET long_desc = $LD$Being a teenager today is its own kind of hard — the academic pressure, the social media, the identity questions, the friendships that shift overnight, the loneliness that can sit right next to a packed schedule. If your teen has been more anxious, withdrawn, irritable, or just not themselves, therapy can give them a place that is theirs alone.

Our clinicians who work with teens are developmentally informed and meet teens where they actually are — not where adults wish they were. We support teens through anxiety, depression, school stress, perfectionism, identity exploration (including LGBTQIA+ identity), social and family conflict, grief, self-harm, body image, and the after-effects of bullying or trauma. Approaches include cognitive behavioral therapy, dialectical behavior therapy skills, parts work, and mindfulness, adapted for teen brains.

Parents are part of the picture, not on the outside of it. We collaborate with families on the right level of involvement — enough that you know how to support, never so much that your teen stops trusting the space. Confidentiality, and its limits, are explained clearly to everyone up front.

Teen therapy is available in-person in Las Vegas and by HIPAA-compliant telehealth anywhere in Nevada, which often fits better with school and activity schedules.$LD$
WHERE slug = 'teen';

UPDATE bt.specialties SET long_desc = $LD$Children communicate through behavior, play, and the body long before they have the words for what is happening inside. When a child is struggling — with worry, big feelings, sleep, school, a family change, or something scary that happened — therapy gives them tools and language that meet their stage of development.

Our clinicians who specialize in younger children use play-based and expressive approaches alongside evidence-based methods like trauma-focused cognitive behavioral therapy and parts work, adapted for kids. We pay close attention to what the child is telling us through the play, and we translate that back to parents in a way that helps you support them between sessions.

Caregivers are essential collaborators. Most child therapy includes regular parent check-ins, parent-coaching, and occasional family sessions, because so much of a child's progress depends on the relationships and routines around them. We will be transparent about what we are working on and why.

Child therapy is offered primarily in-person at our Las Vegas offices, where the playroom space matters, with limited telehealth for older children when appropriate.$LD$
WHERE slug = 'child';

UPDATE bt.specialties SET long_desc = $LD$Grief is not a problem to be solved. It is the long, uneven response to losing something or someone that mattered — a person, a relationship, a pregnancy, a parent who is still here but not the same, a future you had planned. There is no correct timeline, and there is no version of you that has to "be okay" by now.

Our therapists support clients through every kind of loss — recent and old, sudden and anticipated, acknowledged and the kind nobody else seems to remember. We hold space for the full range of grief: numbness, anger, guilt, relief, exhaustion, longing, and the strange days when you feel almost normal and then a song undoes you.

When grief becomes complicated — stuck, trauma-tinged, or tangled with depression — we use approaches like EMDR and Parts and Memory Therapy alongside narrative and meaning-focused work. The goal is never to take the love out of the loss, but to help you carry it in a way that does not flatten the rest of your life.

Grief support is available for adults, teens, and older adults, in-person in Las Vegas or by HIPAA-compliant telehealth across Nevada.$LD$
WHERE slug = 'grief';

UPDATE bt.specialties SET long_desc = $LD$Some of the hardest seasons are not the ones with a clear diagnosis — they are the in-between ones. A new job, a new city, a graduation, a divorce, an empty nest, becoming a parent, leaving a faith, retiring, losing your sense of who you are after years of being someone for everyone else. Life transitions can feel disorienting even when they are good on paper.

Therapy during a transition is part anchor, part navigation. We help you name what you are actually leaving behind, grieve what needs grieving, and clarify what you want this next chapter to be built around. We use approaches like acceptance and commitment therapy, narrative therapy, parts work, and values-based coaching, adapted to where you actually are.

You do not need to be in crisis to start. Many of our most meaningful pieces of work happen with clients who came in saying "I do not really know why I am here, just — something is shifting." That is exactly when therapy can do its best, most preventive work.

Life-transitions care is offered for adults and older adults, in-person in Las Vegas or via secure telehealth across Nevada.$LD$
WHERE slug = 'life-transitions';

UPDATE bt.specialties SET long_desc = $LD$Most of us were never taught how to do relationships well — not romantic relationships, not friendships, not family, not work. We picked up patterns from the people around us, and those patterns followed us into adulthood, some helpful and some that quietly cost us a lot.

Relationship-focused therapy is for the individual who keeps ending up in the same dynamic and wants to understand why. We look at attachment style, family-of-origin patterns, communication habits, boundaries, conflict avoidance, people-pleasing, and the inner critic that keeps you small. Approaches include attachment-informed therapy, cognitive behavioral therapy, parts work, and emotion-focused techniques.

This work tends to ripple outward. Clients often start it for one specific relationship and end up changing how they show up across most of them — including the one with themselves. It is steady, sometimes uncomfortable, and very rewarding.

We see adults and teens for relationship-focused work, in-person in Las Vegas or by HIPAA-compliant telehealth anywhere in Nevada.$LD$
WHERE slug = 'relationship';

UPDATE bt.specialties SET long_desc = $LD$Mental health does not retire. Later life brings its own real challenges — chronic health conditions, mobility shifts, grief stacked on grief, caregiving, the loss of independence, changes in cognition, identity questions about purpose and legacy — and it deserves care that takes those challenges seriously rather than minimizing them.

Our clinicians provide therapy designed for older adults and their families. We support depression and anxiety in later life, adjustment to medical diagnoses, caregiver burnout, loneliness and isolation, grief and end-of-life concerns, and early cognitive changes. We coordinate with primary care and other providers when that helps, with your consent.

Sessions are paced thoughtfully and never rushed. We are comfortable working over telehealth when getting to an office is hard, and we are equally comfortable with in-person care. Family members are welcome to join when it would help, and we are practiced at being a steady presence for adult children who are worried about a parent.

Geriatric care is offered in-person in Las Vegas and by HIPAA-compliant telehealth across Nevada, including from home and assisted-living settings.$LD$
WHERE slug = 'geriatric';
