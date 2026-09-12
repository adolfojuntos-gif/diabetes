/**
 * Seed exercise ideas. Short, concrete, no jargon. `glucoseNote` says what to expect or watch;
 * it never suggests changing a dose. Vigorous ideas carry a plain reminder for people on insulin
 * or sulfonylureas to carry fast carbs and talk activity through with their care team.
 */
import type { exerciseIdeas } from "@/lib/db/schema";

const INSULIN_REMINDER =
  "If you use insulin or a sulfonylurea, carry fast carbs and talk through vigorous activity with your care team first.";

export const EXERCISE_IDEAS: typeof exerciseIdeas.$inferInsert[] = [
  /* --------------------------------- walk --------------------------------- */
  {
    id: "after-dinner-block-loop",
    title: "After-dinner loop around the block",
    kind: "walk",
    minutes: 10,
    intensity: "light",
    tags: "after_meal,outdoors,no_equipment,anytime",
    body:
      "Put your shoes on within 20 minutes of finishing dinner and walk one comfortable loop around your block or building. Keep it easy enough to chat; you are not trying to break a sweat. Come back, sit down, done.",
    glucoseNote:
      "A 10-minute walk after eating typically softens the 2-hour rise; check at 2 hours to see your own number.",
  },
  {
    id: "morning-sunlight-walk",
    title: "Morning sunlight walk",
    kind: "walk",
    minutes: 15,
    intensity: "light",
    tags: "morning,outdoors,no_equipment",
    body:
      "Before breakfast or right after, step outside and walk 7 minutes out and 7 back. Face the light, keep your hands free, leave your phone in your pocket. It doubles as a wake-up for your body clock.",
    glucoseNote:
      "Some people see a small morning rise before eating; a gentle walk often keeps it in check, so compare your pre-breakfast reading on walk days and no-walk days.",
  },
  {
    id: "hallway-laps",
    title: "Hallway laps",
    kind: "walk",
    minutes: 10,
    intensity: "light",
    tags: "after_meal,indoors,low_energy,travel,no_equipment",
    body:
      "Walk the length of your hallway, hotel corridor or apartment and back, over and over, for 10 minutes. Count laps if it helps you stay with it. Bad weather and low energy are not a reason to skip; this one asks almost nothing of you.",
    glucoseNote:
      "Even slow indoor walking after a meal tends to trim the peak a little; it will not show as dramatically as a brisk walk, so give it a few days before judging.",
  },
  {
    id: "airport-terminal-walk",
    title: "Airport terminal walk",
    kind: "walk",
    minutes: 20,
    intensity: "light",
    tags: "travel,indoors,no_equipment",
    body:
      "Once you are through security, skip the moving walkways and walk the length of your terminal and back. Roll your shoulders as you go; you have been sitting and you will sit again. Aim for 20 minutes before boarding.",
    glucoseNote:
      "Travel days often run higher than usual from sitting and unfamiliar food, and a terminal walk is one of the few levers you have, so check before boarding to see where you stand.",
  },
  {
    id: "hotel-stairwell-climb",
    title: "Hotel stairwell climb",
    kind: "walk",
    minutes: 10,
    intensity: "moderate",
    tags: "travel,indoors,no_equipment",
    body:
      "Find the hotel stairwell and climb three or four floors at a steady pace, then walk back down. Repeat until 10 minutes are up. Hold the rail on the way down and stop if you feel light-headed.",
    glucoseNote:
      "Stairs work harder than flat walking and can bring glucose down faster than you expect; keep a fast carb in your pocket and check afterwards.",
  },
  {
    id: "brisk-lunch-walk",
    title: "Brisk walk after lunch",
    kind: "walk",
    minutes: 20,
    intensity: "moderate",
    tags: "after_meal,outdoors,no_equipment",
    body:
      "Right after lunch, walk fast enough that talking takes a little effort, for 10 minutes out and 10 minutes back. Swing your arms and pick a turnaround point before you start so you do not negotiate with yourself.",
    glucoseNote:
      "A brisk 20-minute walk after a meal often flattens the peak more than a slow one; check at 1 and 2 hours to learn your own response.",
  },
  {
    id: "walk-and-talk-call",
    title: "Walk-and-talk phone call",
    kind: "walk",
    minutes: 25,
    intensity: "light",
    tags: "anytime,desk,outdoors,indoors,no_equipment",
    body:
      "Take your next phone call standing up and walking, outside if you can, around the room if not. Use earbuds so your hands are free. One long call a day quietly adds a couple of thousand steps.",
    glucoseNote:
      "Breaking up sitting with movement, even light movement, tends to keep the daytime line steadier; look at your afternoon readings over a week rather than a single check.",
  },
  {
    id: "family-after-dinner-walk",
    title: "Family walk after dinner",
    kind: "walk",
    minutes: 20,
    intensity: "light",
    tags: "after_meal,with_kids,outdoors,no_equipment",
    body:
      "Make the after-dinner walk a family habit: everyone out the door before the dishes, scooters and strollers welcome. Let the kids pick the route. Twenty minutes counts even with stops to look at bugs.",
    glucoseNote:
      "Stop-and-start walking still softens the post-dinner rise; check at 2 hours and compare with an evening you stayed on the couch.",
  },

  /* ------------------------------- strength ------------------------------- */
  {
    id: "sit-to-stand-sets",
    title: "Sit-to-stand sets",
    kind: "strength",
    minutes: 5,
    intensity: "moderate",
    tags: "chair,no_equipment,indoors,anytime,low_energy",
    body:
      "From a sturdy chair, stand up without using your hands, then sit back down slowly. Do 10, rest a minute, and repeat two more times. Cross your arms over your chest to make it harder, or use the armrests to make it easier.",
    glucoseNote:
      "Leg muscles are the biggest sugar users in the body, so short bursts like this can nudge glucose down over the next hour; check afterwards if you are curious.",
  },
  {
    id: "wall-push-ups",
    title: "Wall push-ups",
    kind: "strength",
    minutes: 5,
    intensity: "light",
    tags: "no_equipment,indoors,anytime,travel",
    body:
      "Stand an arm's length from a wall, hands flat at shoulder height. Bend your elbows to bring your chest toward the wall, then push back. Do 12, shake out your arms, and do two more sets. Step your feet further back to make it harder.",
    glucoseNote:
      "Upper-body work this light will not move glucose much on its own; think of it as building the habit rather than expecting a change on the meter.",
  },
  {
    id: "kitchen-counter-squats-calf-raises",
    title: "Kitchen counter squats and calf raises",
    kind: "strength",
    minutes: 8,
    intensity: "light",
    tags: "indoors,no_equipment,after_meal,anytime",
    body:
      "While the kettle boils or the dishes soak, hold the counter lightly and do 10 slow squats, sitting back as if into a chair. Then rise onto your toes for 15 calf raises. Alternate for 8 minutes.",
    glucoseNote:
      "Doing this right after a meal uses the legs at the moment glucose is arriving, and many people see a slightly lower 1-hour reading as a result.",
  },
  {
    id: "resistance-band-desk-rows",
    title: "Resistance band rows at your desk",
    kind: "strength",
    minutes: 10,
    intensity: "moderate",
    tags: "desk,chair,indoors,anytime",
    body:
      "Loop a resistance band around a closed door handle or under your feet while seated. Pull the ends toward your ribs, squeezing your shoulder blades, then release slowly. Do 12, rest, and repeat 3 times; finish with 12 overhead presses.",
    glucoseNote:
      "Ten minutes of moderate strength work may lower glucose gradually over the following hours rather than immediately; check before dinner rather than right after.",
  },
  {
    id: "bodyweight-circuit",
    title: "Bodyweight circuit",
    kind: "strength",
    minutes: 20,
    intensity: "vigorous",
    tags: "no_equipment,indoors,morning",
    body:
      "Set a timer and cycle through 40 seconds each of squats, push-ups (knees down is fine), reverse lunges, and a plank, with 20 seconds rest between. Go round 4 times. Move at a pace that leaves you breathing hard but still able to keep good form.",
    glucoseNote:
      "Hard efforts can push glucose up briefly and then bring it down for hours afterwards, so check before, right after, and again 2 hours later. " +
      INSULIN_REMINDER,
  },
  {
    id: "hotel-room-strength",
    title: "Hotel room strength session",
    kind: "strength",
    minutes: 15,
    intensity: "moderate",
    tags: "travel,no_equipment,indoors",
    body:
      "Use the bed and a chair: 12 squats to the chair, 10 incline push-ups with hands on the bed frame, 12 glute bridges on the floor, 20 standing marches. Rest a minute and repeat 3 times.",
    glucoseNote:
      "Traveling often means more sitting and richer meals; a short strength session helps your muscles keep pulling glucose in, so compare your evening readings on days you do it.",
  },
  {
    id: "water-bottle-arm-workout",
    title: "Water bottle arm workout",
    kind: "strength",
    minutes: 10,
    intensity: "light",
    tags: "chair,low_energy,indoors,travel,desk",
    body:
      "Sit tall with a full water bottle in each hand. Do 12 bicep curls, 12 overhead presses, and 12 lateral raises to shoulder height. Rest, drink some of the water, and go again twice.",
    glucoseNote:
      "This is gentle and mostly upper body, so expect little change on the meter; it counts because it keeps you moving on a day you would otherwise not.",
  },
  {
    id: "stair-step-ups",
    title: "Stair step-ups",
    kind: "strength",
    minutes: 10,
    intensity: "moderate",
    tags: "no_equipment,indoors,after_meal",
    body:
      "Stand at the bottom step. Step up with your right foot, bring the left up, step back down, and switch the leading leg. Keep a steady rhythm for 2 minutes, rest 1 minute, and repeat 3 times. Hold the rail if you need it.",
    glucoseNote:
      "Ten minutes of step-ups after a meal is a solid leg effort and typically blunts the rise; check at 1 hour to see how much.",
  },

  /* ------------------------------- mobility ------------------------------- */
  {
    id: "desk-neck-shoulder-reset",
    title: "Desk neck and shoulder reset",
    kind: "mobility",
    minutes: 5,
    intensity: "light",
    tags: "desk,chair,indoors,anytime",
    body:
      "Sit back from the screen. Roll your shoulders backward 10 times, tilt your ear toward each shoulder and hold for 20 seconds, then clasp your hands behind you and lift your chest. Finish by looking over each shoulder slowly.",
    glucoseNote:
      "Stretching does not move glucose in a way you will see on the meter, but easing tension can take the edge off stress, which does affect it for some people.",
  },
  {
    id: "seated-ankle-foot-circles",
    title: "Seated ankle circles and toe spreads",
    kind: "mobility",
    minutes: 5,
    intensity: "light",
    tags: "chair,desk,low_energy,anytime,indoors",
    body:
      "Sitting down, lift one foot and draw 10 slow circles with your toes in each direction, then switch. Spread your toes wide and squeeze them 10 times. Finish by writing the alphabet in the air with each big toe.",
    glucoseNote:
      "This is about keeping blood flowing to your feet rather than changing glucose; it pairs well with the evening habit of looking your feet over.",
  },
  {
    id: "morning-bed-stretch",
    title: "Morning stretch before getting up",
    kind: "mobility",
    minutes: 8,
    intensity: "light",
    tags: "morning,low_energy,indoors,no_equipment",
    body:
      "Before you get out of bed, hug both knees to your chest for 30 seconds, then drop them to each side for a gentle twist. Reach your arms overhead and point your toes for a long full-body stretch. Sit on the edge of the bed and roll your shoulders before you stand.",
    glucoseNote:
      "It will not change your fasting number, but starting the day moving often makes the morning walk or other activity more likely to happen.",
  },
  {
    id: "gentle-yoga-flow",
    title: "Gentle yoga flow",
    kind: "mobility",
    minutes: 20,
    intensity: "light",
    tags: "indoors,no_equipment,morning,anytime",
    body:
      "On a mat or towel, move slowly through cat-cow, child's pose, a low lunge on each side, a forward fold, and finish lying on your back with knees bent. Hold each for 5 or 6 slow breaths. Follow a free 20-minute beginner video if you would rather not think about it.",
    glucoseNote:
      "Slow yoga tends to lower glucose only slightly, but many people find calmer sessions help with the stress-related rises they see on hard days.",
  },
  {
    id: "airplane-seat-stretches",
    title: "Airplane seat stretches",
    kind: "mobility",
    minutes: 5,
    intensity: "light",
    tags: "travel,chair,anytime",
    body:
      "Every hour in the air: press your heels down and lift your toes 15 times, then lift your heels 15 times. Squeeze your thighs together for 5 seconds, 5 times. Roll your shoulders and gently twist to look behind you on each side.",
    glucoseNote:
      "Long flights tend to push readings up from sitting still and airline food; these small moves help circulation more than glucose, so plan a walk in the aisle too.",
  },
  {
    id: "evening-hip-opener-stretch",
    title: "Evening hip and hamstring stretch",
    kind: "mobility",
    minutes: 10,
    intensity: "light",
    tags: "indoors,anytime,no_equipment",
    body:
      "Sit on the floor with one leg straight and the other bent, foot to the inner thigh, and reach toward the straight leg for 45 seconds each side. Lie on your back and pull one knee across your body for a twist. Finish with a figure-four stretch, ankle on the opposite knee.",
    glucoseNote:
      "Stretching will not show on the meter, but a wind-down routine before bed can improve sleep, and better sleep tends to show up as a steadier morning reading.",
  },

  /* -------------------------------- cardio -------------------------------- */
  {
    id: "stationary-bike-easy-spin",
    title: "Easy spin on a stationary bike",
    kind: "cardio",
    minutes: 20,
    intensity: "moderate",
    tags: "indoors,after_meal",
    body:
      "Set the resistance low enough that you could hold a conversation and pedal for 20 minutes. Put on a podcast or an episode of something. If you have no bike, a gym bike or a pedal exerciser under the desk does the same job.",
    glucoseNote:
      "Twenty minutes of easy cycling after a meal usually brings the 2-hour number down noticeably; check to see your own response.",
  },
  {
    id: "jump-rope-intervals",
    title: "Jump rope or jumping-jack intervals",
    kind: "cardio",
    minutes: 10,
    intensity: "vigorous",
    tags: "no_equipment,indoors,outdoors,morning",
    body:
      "Skip rope, or do jumping jacks if you have no rope, for 30 seconds, then walk in place for 30 seconds. Repeat 10 times. Land softly on the balls of your feet and stop early if your knees or feet complain.",
    glucoseNote:
      "Short hard intervals can raise glucose briefly, then lower it for several hours, so check right after and again 2 hours later to learn your pattern. " +
      INSULIN_REMINDER,
  },
  {
    id: "seated-marching-cardio",
    title: "Seated marching",
    kind: "cardio",
    minutes: 10,
    intensity: "light",
    tags: "chair,desk,low_energy,indoors,no_equipment",
    body:
      "Sit toward the front of a chair with your feet flat. March your knees up one at a time, pumping your arms, for 1 minute, then rest 30 seconds. Repeat until 10 minutes are up. Speed up the last round if you feel good.",
    glucoseNote:
      "It is gentler than walking, but done after a meal it still uses the legs while glucose is coming in; check at 2 hours and see if it makes a small difference for you.",
  },
  {
    id: "pool-walk-or-swim",
    title: "Pool walk or easy swim",
    kind: "cardio",
    minutes: 30,
    intensity: "moderate",
    tags: "travel,outdoors,anytime",
    body:
      "In a hotel or community pool, walk laps in chest-deep water for 15 minutes, then swim easy lengths or tread water for 15. The water takes weight off your joints and keeps you cool. Rinse your feet and dry between the toes afterwards.",
    glucoseNote:
      "Water hides how hard you are working, and glucose can drop more than expected in the hour after, so check when you get out and keep a snack at the poolside. " +
      INSULIN_REMINDER,
  },
  {
    id: "interval-walk-jog",
    title: "Walk-jog intervals",
    kind: "cardio",
    minutes: 25,
    intensity: "vigorous",
    tags: "outdoors,no_equipment,morning",
    body:
      "Walk 5 minutes to warm up. Then jog 1 minute, walk 2 minutes, and repeat 5 times. Walk the last 5 minutes to cool down. Wear shoes that fit well and check your feet when you get home.",
    glucoseNote:
      "Jogging can push glucose down for many hours afterwards, including overnight, so check before bed on days you do this. " +
      INSULIN_REMINDER,
  },
  /* --------------------------------- play --------------------------------- */
  {
    id: "playground-tag",
    title: "Playground tag",
    kind: "play",
    minutes: 15,
    intensity: "moderate",
    tags: "with_kids,outdoors,no_equipment",
    body:
      "Take the kids to the playground and actually play: tag, chase, or racing them to the slide. Let them make the rules. Fifteen minutes of this is real exercise, and you will not notice the time.",
    glucoseNote:
      "Chasing kids is stop-and-go effort that can bring glucose down faster than a steady walk, so check afterwards and keep a snack in the bag.",
  },
  {
    id: "living-room-dance-party",
    title: "Living room dance party",
    kind: "play",
    minutes: 10,
    intensity: "moderate",
    tags: "with_kids,indoors,no_equipment,anytime",
    body:
      "Put on three songs everyone likes and dance in the living room until they finish. Big arms, silly moves, whatever gets you laughing. It works just as well alone, with the door closed.",
    glucoseNote:
      "Ten minutes of moving to music after dinner counts as an after-meal walk in disguise; check at 2 hours to see whether the peak is lower.",
  },
  {
    id: "backyard-soccer-passes",
    title: "Backyard soccer passes",
    kind: "play",
    minutes: 20,
    intensity: "moderate",
    tags: "with_kids,outdoors",
    body:
      "Kick a ball back and forth in the yard or park, then set up two jumpers as a goal and take turns as keeper. Keep it moving; chasing the ball down is the exercise. Twenty minutes and everyone is ready for a drink of water.",
    glucoseNote:
      "Twenty minutes of running around usually brings glucose down over the following hour or two; check afterwards, especially if you played hard.",
  },
  {
    id: "balloon-keep-up",
    title: "Balloon keep-up",
    kind: "play",
    minutes: 10,
    intensity: "light",
    tags: "with_kids,indoors,no_equipment,low_energy",
    body:
      "Blow up a balloon and keep it off the floor with the kids, using hands, heads, feet, anything. Count hits and try to beat your record. It is gentle enough for a tired evening and fun enough that nobody argues.",
    glucoseNote:
      "This is light movement, so expect little on the meter; it is here for the days when the choice is this or nothing.",
  },
  {
    id: "family-bike-ride",
    title: "Family bike ride",
    kind: "play",
    minutes: 30,
    intensity: "moderate",
    tags: "with_kids,outdoors",
    body:
      "Ride a flat, quiet route for 15 minutes out and 15 back at the pace of the slowest rider. Pack water and a snack for everyone. Helmets on, and check tire pressure before you leave so nobody is fighting the bike.",
    glucoseNote:
      "Thirty minutes of cycling can lower glucose for hours afterwards, so bring a fast carb and check when you get home and again before bed.",
  },
];
