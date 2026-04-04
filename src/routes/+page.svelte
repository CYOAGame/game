<script lang="ts">
	import { goto } from '$app/navigation';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { initializeWorldState, loadWorldState, loadWorldBlocks, saveWorldState, saveWorldBlocks } from '$lib/engine/world-loader';
	import type { WorldBlocks } from '$lib/engine/world-loader';
	import { onMount } from 'svelte';

	let hasSavedWorld = $state(false);

	onMount(() => {
		const saved = loadWorldState();
		hasSavedWorld = saved !== null;
	});

	function getDemoWorldBlocks(): WorldBlocks {
		return {
			config: {
				name: 'Ironhaven',
				description: 'A medieval kingdom under the shadow of a rising demon lord.',
				setting: 'medieval',
				dateSystem: {
					seasons: ['spring', 'summer', 'autumn', 'winter'],
					daysPerSeason: 30,
					startYear: 845
				},
				startingFactions: [
					{ id: 'town_guard', name: 'Town Guard', description: 'The local militia', initialMood: 5 },
					{ id: 'craftsmen_guild', name: "Craftsmen's Guild", description: 'Artisans and makers', initialMood: 6 },
					{ id: 'merchant_guild', name: 'Merchant Guild', description: 'Traders and shopkeepers', initialMood: 7 },
					{ id: 'village_folk', name: 'Village Folk', description: 'Common townsfolk', initialMood: 6 }
				],
				activeQuestlines: ['demon_invasion'],
				theme: {
					backgroundImage: 'themes/default/background.jpg',
					fontFamily: 'Georgia, serif'
				}
			},
			archetypes: [
				{
					id: 'blacksmith',
					name: 'Blacksmith',
					traits: {
						strength: { min: 5, max: 9 },
						cunning: { min: 2, max: 5 },
						charisma: { min: 3, max: 6 }
					},
					skills: ['forging', 'haggling'],
					namingPatterns: ['Elena', 'Bjorn', 'Thora', 'Garrick'],
					factions: ['craftsmen_guild'],
					locations: ['market_quarter', 'forge_district'],
					activities: ['hammering at the anvil', 'inspecting a blade', 'stoking the forge']
				},
				{
					id: 'merchant',
					name: 'Traveling Merchant',
					traits: {
						strength: { min: 2, max: 5 },
						cunning: { min: 5, max: 9 },
						charisma: { min: 6, max: 9 }
					},
					skills: ['haggling', 'appraisal', 'navigation'],
					namingPatterns: ['Marcus', 'Lydia', 'Fenwick', 'Asha'],
					factions: ['merchant_guild'],
					locations: ['market_quarter', 'docks', 'trade_road'],
					activities: ['counting coins', 'examining wares', 'consulting a ledger']
				},
				{
					id: 'soldier',
					name: 'Soldier',
					traits: {
						strength: { min: 6, max: 9 },
						cunning: { min: 3, max: 6 },
						charisma: { min: 2, max: 5 }
					},
					skills: ['swordsmanship', 'tactics', 'endurance'],
					namingPatterns: ['Aldric', 'Kira', 'Voss', 'Brenna'],
					factions: ['town_guard'],
					locations: ['barracks', 'town_gate', 'watchtower'],
					activities: ['polishing armor', 'drilling formations', 'standing watch']
				}
			],
			events: [
				// ── TRAVELER ARC ──────────────────────────────────────────────────
				{
					id: 'traveler_arrives',
					name: 'A Traveler Arrives',
					tags: ['social', 'intrigue'],
					preconditions: [],
					roles: [
						{
							id: 'traveler',
							label: 'A Weary Traveler',
							traitRequirements: { cunning: { min: 3 } }
						},
						{
							id: 'guard',
							label: 'A Town Guard',
							archetypeFilter: ['soldier'],
							factionRequirements: ['town_guard']
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'A stranger slips through the town gate just before dusk — dusty, limping, clutching a worn leather satchel to their chest. {traveler.name} scans the square with wide, frightened eyes and fixes on you. "Please," they rasp. "I need somewhere safe. Just for tonight."',
							choices: [
								{
									id: 'help_and_hide',
									label: 'Pull them inside and find a hiding place',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'relationship', target: '{traveler.id}', value: 3, axis: 'trust' },
										{ type: 'relationship_tag', target: '{traveler.id}', value: 'sheltered_traveler' },
										{ type: 'world_fact', target: 'traveler_hidden', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: 'hidden_them'
								},
								{
									id: 'take_to_guard',
									label: 'Bring them to {guard.name} for proper protection',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 2 },
										{ type: 'relationship', target: '{guard.id}', value: 2, axis: 'trust' },
										{ type: 'world_fact', target: 'traveler_reported', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: 'reported_to_guard'
								},
								{
									id: 'turn_away',
									label: 'Tell them you cannot help and turn them away',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'traveler_turned_away', value: true }
									],
									exhaustionCost: 0,
									nextNodeId: 'turned_away'
								}
							]
						},
						hidden_them: {
							id: 'hidden_them',
							text: 'You tuck {traveler.name} into the back of the cooperage, behind old barrel staves. They press the satchel closer. "You have no idea what you have done for me," they whisper. "Or what is in here." They do not say more — not yet.',
							choices: [
								{
									id: 'ask_whats_inside',
									label: 'Ask what they are carrying',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'leave_them_rest',
									label: 'Tell them to rest and ask no questions tonight',
									consequences: [
										{ type: 'relationship', target: '{traveler.id}', value: 1, axis: 'affection' }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						},
						reported_to_guard: {
							id: 'reported_to_guard',
							text: '{guard.name} listens, nods, and takes {traveler.name} firmly by the arm. "You did right bringing them in," the guard says to you. "We will look after this." {traveler.name} shoots you a look you cannot quite read — fear, or something harder.',
							choices: [
								{
									id: 'stay_to_explain',
									label: 'Stay and explain what the traveler told you',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 1 },
										{ type: 'stat', target: 'charisma', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'leave_it_there',
									label: 'Leave them to it and go about your evening',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						},
						turned_away: {
							id: 'turned_away',
							text: '{traveler.name} stares at you for a long moment — too tired even for anger — then turns and limps back toward the gate. You watch them go. The satchel knocks against their hip with every step. You wonder, briefly, what was in it.',
							choices: [
								{
									id: 'reconsider',
									label: 'Call them back — you have changed your mind',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'relationship', target: '{traveler.id}', value: 1, axis: 'trust' },
										{ type: 'world_fact', target: 'traveler_turned_away', value: false },
										{ type: 'world_fact', target: 'traveler_hidden', value: true },
										{ type: 'relationship_tag', target: '{traveler.id}', value: 'sheltered_traveler' }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'let_them_go',
									label: 'Let them go. It is not your concern.',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'satchels_secret',
					name: "The Satchel's Secret",
					tags: ['intrigue', 'social'],
					preconditions: [
						{ type: 'world_fact', key: 'traveler_hidden', value: true }
					],
					roles: [
						{
							id: 'traveler',
							label: 'The Hidden Traveler',
							traitRequirements: { cunning: { min: 3 } }
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'You find {traveler.name} where you left them. They look steadier now, though their hands still shake. "I owe you an explanation," they say. They open the satchel. Inside, wrapped in oilcloth: a sheaf of letters bearing a noble crest — correspondence between someone in this town and someone who should be an enemy.',
							choices: [
								{
									id: 'help_deliver',
									label: 'Agree to help get the letters where they need to go',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'relationship', target: '{traveler.id}', value: 3, axis: 'trust' },
										{ type: 'world_fact', target: 'satchel_delivered', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: 'agreed_to_deliver'
								},
								{
									id: 'open_it_yourself',
									label: 'Read the letters yourself before deciding anything',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'satchel_opened', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: 'read_the_letters'
								},
								{
									id: 'back_out',
									label: 'This is too dangerous. Tell them to find another way.',
									consequences: [
										{ type: 'relationship', target: '{traveler.id}', value: -2, axis: 'trust' }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						},
						agreed_to_deliver: {
							id: 'agreed_to_deliver',
							text: '{traveler.name} grips your arm. "You are braver than you look. The letters go to the miller\'s widow on the east road — she will know what to do with them." They press a small coin into your palm. "And if anyone asks, you have not seen me."',
							choices: [
								{
									id: 'head_out_now',
									label: 'Go deliver them immediately',
									consequences: [
										{ type: 'faction', target: 'village_folk', value: 1 },
										{ type: 'stat', target: 'strength', value: 1 }
									],
									exhaustionCost: 2,
									nextNodeId: null
								},
								{
									id: 'wait_for_dark',
									label: 'Wait until after dark to move less conspicuously',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						read_the_letters: {
							id: 'read_the_letters',
							text: 'The letters are damning — evidence of a local merchant trading information to a foreign power. Your hands are steady as you reseal them, but your mind is racing. You now know something dangerous. That changes things.',
							choices: [
								{
									id: 'use_knowledge',
									label: 'Keep quiet for now — knowledge like this has value',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 2 },
										{ type: 'world_fact', target: 'knows_merchant_secret', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'report_content',
									label: 'This needs to go to the town guard immediately',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 3 },
										{ type: 'world_fact', target: 'merchant_denounced', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'guards_questions',
					name: "The Guard's Questions",
					tags: ['intrigue', 'action'],
					preconditions: [
						{ type: 'world_fact', key: 'traveler_reported', value: true }
					],
					roles: [
						{
							id: 'guard',
							label: 'The Questioning Guard',
							archetypeFilter: ['soldier'],
							factionRequirements: ['town_guard']
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: '{guard.name} finds you the next morning. "That traveler you brought in," they say, keeping their voice low. "They are not talking. But someone else says they saw you speaking with a stranger near the gate around the same time. You see anything else?" Their eyes do not leave your face.',
							choices: [
								{
									id: 'tell_everything',
									label: 'Tell them everything you know about the traveler',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 2 },
										{ type: 'relationship', target: '{guard.id}', value: 2, axis: 'trust' },
										{ type: 'world_fact', target: 'cooperated_with_guard', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: 'told_all'
								},
								{
									id: 'lie_to_protect',
									label: 'Say you saw nothing unusual — the traveler seemed harmless',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'lied_to_guard', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: 'lied'
								},
								{
									id: 'stay_vague',
									label: 'Tell them what you saw but leave out the satchel',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'faction', target: 'town_guard', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						told_all: {
							id: 'told_all',
							text: '{guard.name} listens carefully, noting things down in a small ledger. "You did well to come forward." They close the ledger with a snap. "We will find out what was in that satchel." Something about their certainty makes you slightly uneasy.',
							choices: [
								{
									id: 'ask_what_happens',
									label: 'Ask what will happen to the traveler',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'let_it_go',
									label: 'Nod and get on with your day',
									consequences: [],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						},
						lied: {
							id: 'lied',
							text: '{guard.name} watches you for a long moment. "Right," they say finally. "If you think of anything else, you know where to find me." They leave. You are not sure they believed you. The lie sits in your chest, small and heavy.',
							choices: [
								{
									id: 'commit_to_lie',
									label: 'Good. You made your choice. Stick to it.',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								},
								{
									id: 'reconsider_confession',
									label: 'Go after the guard and tell them the truth',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 1 },
										{ type: 'world_fact', target: 'lied_to_guard', value: false },
										{ type: 'world_fact', target: 'cooperated_with_guard', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'strangers_asking',
					name: 'Strangers Asking',
					tags: ['intrigue', 'danger'],
					preconditions: [
						{ type: 'world_fact', key: 'traveler_hidden', value: true }
					],
					roles: [
						{
							id: 'stranger',
							label: 'A Suspicious Stranger',
							traitRequirements: { cunning: { min: 5 } }
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'Two riders stop you on the road outside town. {stranger.name} leans from the saddle. "We are looking for someone who came through here. Carries a leather satchel, travels alone." Their smile does not reach their eyes. "You would remember someone like that."',
							choices: [
								{
									id: 'deny_knowledge',
									label: 'Shake your head — you have not seen anyone like that',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'denied_traveler_to_hunters', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: 'denied'
								},
								{
									id: 'point_wrong_way',
									label: 'Send them toward the south road — wrong direction',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 2 },
										{ type: 'world_fact', target: 'misdirected_hunters', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: 'misdirected'
								},
								{
									id: 'tell_truth',
									label: 'Tell them what you know — this is not your fight',
									consequences: [
										{ type: 'world_fact', target: 'betrayed_traveler', value: true }
									],
									exhaustionCost: 0,
									nextNodeId: 'told_truth'
								}
							]
						},
						denied: {
							id: 'denied',
							text: '{stranger.name} studies you. A long silence. Then they nod once and ride on. You watch until they are out of sight, then let out a slow breath. You hope that was enough.',
							choices: [
								{
									id: 'warn_traveler',
									label: 'Go warn the traveler immediately',
									consequences: [
										{ type: 'relationship', target: '{stranger.id}', value: -1, axis: 'trust' },
										{ type: 'stat', target: 'charisma', value: 1 }
									],
									exhaustionCost: 2,
									nextNodeId: null
								},
								{
									id: 'keep_watch',
									label: 'Watch the road for a while to make sure they have gone',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						misdirected: {
							id: 'misdirected',
							text: 'The riders exchange a glance, then wheel their horses south. You watch them go, heart hammering. You bought some time. Possibly a day, possibly less — depending on how long before they figure out you lied.',
							choices: [
								{
									id: 'use_time_wisely',
									label: 'Use the time to help the traveler get clear of town',
									consequences: [
										{ type: 'stat', target: 'strength', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 3,
									nextNodeId: null
								},
								{
									id: 'lay_low',
									label: 'Go home and act normal until the dust settles',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						},
						told_truth: {
							id: 'told_truth',
							text: '{stranger.name}\'s expression shifts — something colder underneath. "Good. We thought so." A coin lands in the dirt at your feet. They ride back toward town without another word. You do not pick up the coin.',
							choices: [
								{
									id: 'try_to_warn',
									label: 'Run to warn the traveler before the riders arrive',
									consequences: [
										{ type: 'stat', target: 'strength', value: 1 },
										{ type: 'exhaustion', target: 'self', value: 2 }
									],
									exhaustionCost: 3,
									nextNodeId: null
								},
								{
									id: 'do_nothing',
									label: 'You told them what you knew. That is the end of it.',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						}
					}
				},
				// ── DAILY LIFE ARC ────────────────────────────────────────────────
				{
					id: 'bandit_raid',
					name: 'Bandit Raid',
					tags: ['action', 'combat', 'danger'],
					preconditions: [
						{ type: 'questline_stage', key: 'demon_invasion', value: 'border_falls', operator: 'gte' }
					],
					roles: [
						{
							id: 'bandit_leader',
							label: 'The Bandit Leader',
							traitRequirements: { strength: { min: 5 }, cunning: { min: 4 } }
						},
						{
							id: 'bystander',
							label: 'A Frightened Bystander',
							archetypeFilter: ['merchant', 'blacksmith']
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'Shouts erupt from the market square. Three armed figures push through the crowd, blades drawn. {bandit_leader.name} points at the merchant stalls.',
							choices: [
								{
									id: 'fight',
									label: 'Stand your ground and fight',
									preconditions: [{ type: 'trait', key: 'strength', min: 5 }],
									consequences: [
										{ type: 'stat', target: 'strength', value: 1 },
										{ type: 'faction', target: 'town_guard', value: 2 },
										{ type: 'questline', target: 'demon_invasion:border_defense', value: 1 }
									],
									exhaustionCost: 3,
									nextNodeId: 'fight_result'
								},
								{
									id: 'hide',
									label: 'Duck behind the stalls and hide',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'hide_result'
								},
								{
									id: 'help_bystander',
									label: 'Grab {bystander.name} and pull them to safety',
									consequences: [
										{ type: 'relationship', target: '{bystander.id}', value: 3, axis: 'trust' },
										{ type: 'faction', target: 'town_guard', value: 1 }
									],
									exhaustionCost: 2,
									nextNodeId: 'help_result'
								}
							]
						},
						fight_result: {
							id: 'fight_result',
							text: 'You clash with the nearest bandit. Steel rings against steel. The town guard arrives moments later — your stand bought them time.',
							choices: [
								{
									id: 'pursue',
									label: 'Chase the fleeing bandits',
									preconditions: [{ type: 'skill', key: 'endurance' }],
									consequences: [
										{ type: 'exhaustion', target: 'self', value: 3 },
										{ type: 'questline', target: 'demon_invasion:border_defense', value: 2 }
									],
									exhaustionCost: 4,
									nextNodeId: null
								},
								{
									id: 'stay',
									label: 'Help the wounded in the square',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 1 },
										{ type: 'world_fact', target: 'market_raid_survivors', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: null
								}
							]
						},
						hide_result: {
							id: 'hide_result',
							text: 'You press yourself against the wooden stall. Through a gap in the planks you see {bandit_leader.name} ransacking the silversmith. The raid is over in minutes.',
							choices: [
								{
									id: 'emerge',
									label: 'Emerge and check on the others',
									consequences: [
										{ type: 'world_fact', target: 'witnessed_raid', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						help_result: {
							id: 'help_result',
							text: '{bystander.name} stumbles as you pull them behind the well. "Thank you," they gasp. "I thought — I thought they were going to—"',
							choices: [
								{
									id: 'comfort',
									label: 'Stay with them until it passes',
									consequences: [
										{ type: 'relationship', target: '{bystander.id}', value: 2, axis: 'affection' },
										{ type: 'stat', target: 'charisma', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'leave',
									label: 'Make sure they are safe, then head back out',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 1 }
									],
									exhaustionCost: 2,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'harvest_festival',
					name: 'Harvest Festival',
					tags: ['social', 'crafting', 'romance'],
					preconditions: [
						{ type: 'season', key: 'season', value: 'autumn' }
					],
					roles: [
						{
							id: 'festival_organizer',
							label: 'The Festival Organizer',
							traitRequirements: { charisma: { min: 5 } }
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'The village square is strung with lanterns. The smell of roasted apples and spiced cider fills the air. {festival_organizer.name} waves you over from beside the bonfire.',
							choices: [
								{
									id: 'join_feast',
									label: 'Join the communal feast',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'feast_table'
								},
								{
									id: 'enter_contest',
									label: 'Enter the crafting contest',
									preconditions: [{ type: 'skill', key: 'forging' }],
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'faction', target: 'craftsmen_guild', value: 2 }
									],
									exhaustionCost: 2,
									nextNodeId: 'contest_result'
								},
								{
									id: 'help_organize',
									label: 'Offer to help {festival_organizer.name} run the games',
									consequences: [
										{ type: 'relationship', target: '{festival_organizer.id}', value: 2, axis: 'affection' },
										{ type: 'faction', target: 'village_folk', value: 2 }
									],
									exhaustionCost: 2,
									nextNodeId: 'organizing'
								}
							]
						},
						feast_table: {
							id: 'feast_table',
							text: 'The table is long and loud. Somebody passes you a cider, then another. As the evening settles, a hooded figure slides onto the bench across from you. They glance around before leaning in. "You look like someone who can keep a secret."',
							choices: [
								{
									id: 'listen_stranger',
									label: 'Lean in and listen',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'heard_festival_secret', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'brush_off',
									label: 'Politely excuse yourself — not tonight',
									consequences: [
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						contest_result: {
							id: 'contest_result',
							text: '{festival_organizer.name} examines your entry with raised eyebrows. "Impressive," they say. "But old Henryk thinks his piece is better. The crowd will decide." The crowd gathers. This is the moment.',
							choices: [
								{
									id: 'accept_gracefully',
									label: 'Accept the result with grace, win or lose',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'argue_quality',
									label: 'Point out the superior quality of your work',
									consequences: [
										{ type: 'faction', target: 'craftsmen_guild', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						organizing: {
							id: 'organizing',
							text: '{festival_organizer.name} looks relieved. You spend the evening running the ring toss, settling disputes over the apple-bobbing, and generally keeping things from descending into chaos. By the end, {festival_organizer.name} clasps your shoulder. "Same time next year?"',
							choices: [
								{
									id: 'agree',
									label: 'Laugh and agree — you had a good time',
									consequences: [
										{ type: 'relationship', target: '{festival_organizer.id}', value: 2, axis: 'trust' },
										{ type: 'stat', target: 'charisma', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								},
								{
									id: 'noncommit',
									label: 'Make no promises, but smile',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'market_day',
					name: 'Market Day',
					tags: ['social', 'commerce'],
					preconditions: [],
					roles: [
						{
							id: 'trader',
							label: 'A Local Trader',
							archetypeFilter: ['merchant', 'blacksmith']
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'The market is busy today. {trader.name} calls out to you from behind a stall laden with goods.',
							choices: [
								{
									id: 'browse',
									label: 'Browse the wares',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'browse_artifact'
								},
								{
									id: 'barter',
									label: 'Try to barter for a good deal',
									preconditions: [{ type: 'skill', key: 'haggling' }],
									consequences: [
										{ type: 'faction', target: 'merchant_guild', value: 1 }
									],
									exhaustionCost: 2,
									nextNodeId: 'barter_result'
								}
							]
						},
						browse_artifact: {
							id: 'browse_artifact',
							text: 'Among the trinkets, something catches your eye: a tarnished bronze compass with strange markings. {trader.name} notices your interest. "Found that in a shipment from the coast. No idea what the symbols mean."',
							choices: [
								{
									id: 'examine_artifact',
									label: 'Examine the curious artifact more closely',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'found_compass', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'ask_rumors',
									label: 'Chat with {trader.name} about town rumors',
									consequences: [
										{ type: 'faction', target: 'merchant_guild', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						barter_result: {
							id: 'barter_result',
							text: 'You haggle back and forth. {trader.name} narrows their eyes, then breaks into a grin. "You drive a hard bargain." But then they pause. "Actually, I have something else in mind — it will cost you a favor, not coin."',
							choices: [
								{
									id: 'accept_favor',
									label: 'Agree to the favor',
									consequences: [
										{ type: 'faction', target: 'merchant_guild', value: 2 },
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'owes_trader_favor', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'decline_favor',
									label: 'Decline and take the coin deal',
									consequences: [
										{ type: 'faction', target: 'merchant_guild', value: -1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'quiet_morning',
					name: 'A Quiet Morning',
					tags: ['social', 'exploration'],
					preconditions: [],
					roles: [
						{
							id: 'neighbor',
							label: 'A Neighbor',
							archetypeFilter: ['blacksmith', 'merchant', 'soldier']
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'You wake before dawn. The air is cool and the village is quiet. Pale light creeps through the shutters.',
							choices: [
								{
									id: 'visit_well',
									label: 'Head to the village well for fresh water',
									consequences: [
										{ type: 'stat', target: 'strength', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'at_the_well'
								},
								{
									id: 'stay_in',
									label: 'Sit by the window and watch the village wake',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'watching_window'
								}
							]
						},
						at_the_well: {
							id: 'at_the_well',
							text: 'At the well, you find {neighbor.name} already drawing water. They look tired but manage a smile. "Could not sleep either? Strange lights on the ridge last night. Did you see them?"',
							choices: [
								{
									id: 'ask_lights',
									label: 'Ask what they saw exactly',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'offer_help',
									label: 'Offer to help carry their water back',
									consequences: [
										{ type: 'relationship', target: '{neighbor.id}', value: 2, axis: 'trust' },
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						watching_window: {
							id: 'watching_window',
							text: 'The village stirs slowly. You see {neighbor.name} crossing the square, looking harried. They glance up at your window and wave, then beckon you down urgently.',
							choices: [
								{
									id: 'go_down',
									label: 'Go see what they need',
									consequences: [
										{ type: 'relationship', target: '{neighbor.id}', value: 1, axis: 'affection' },
										{ type: 'stat', target: 'charisma', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'wave_back',
									label: 'Wave back but stay put',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'strange_rumors',
					name: 'Strange Rumors',
					tags: ['intrigue', 'social'],
					preconditions: [],
					roles: [
						{
							id: 'barkeep',
							label: 'The Barkeep',
							traitRequirements: { charisma: { min: 3 } }
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'The tavern is quieter than usual. {barkeep.name} wipes the counter with a furrowed brow. A few regulars huddle in the corner, speaking in low voices.',
							choices: [
								{
									id: 'ask_barkeep',
									label: 'Ask {barkeep.name} what the fuss is about',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'barkeep_explains'
								},
								{
									id: 'eavesdrop',
									label: 'Sit nearby and eavesdrop on the corner table',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'overheard'
								}
							]
						},
						barkeep_explains: {
							id: 'barkeep_explains',
							text: '{barkeep.name} leans close. "Folk have been going missing on the south road. Three this month. Guards say bandits, but nobody has found a camp." They pause. "And last night, someone saw a light in the old mill."',
							choices: [
								{
									id: 'investigate_mill',
									label: 'Decide to check out the old mill yourself',
									consequences: [
										{ type: 'stat', target: 'strength', value: 1 },
										{ type: 'world_fact', target: 'investigating_mill', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: null
								},
								{
									id: 'report_guard',
									label: 'Suggest telling the town guard about the light',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 2 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						overheard: {
							id: 'overheard',
							text: 'You catch fragments: "...sealed cellar...", "...symbols on the walls...", "...do not tell the guard." One of them notices you listening and goes silent.',
							choices: [
								{
									id: 'confront',
									label: 'Ask them directly what they know',
									preconditions: [{ type: 'trait', key: 'charisma', min: 4 }],
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 1 },
										{ type: 'world_fact', target: 'knows_cellar_secret', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'leave_quietly',
									label: 'Pretend you heard nothing and leave',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'well_runs_dry',
					name: 'The Well Runs Dry',
					tags: ['social', 'exploration'],
					preconditions: [],
					roles: [
						{
							id: 'elder',
							label: 'A Village Elder',
							traitRequirements: { charisma: { min: 4 } }
						},
						{
							id: 'merchant',
							label: 'A Water Merchant',
							archetypeFilter: ['merchant']
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'The morning line at the well is gone — because there is no water to draw. {elder.name} stands at the rim, looking down with a grim expression. "It has not been dry in my lifetime," they say. Around the square, people look worried.',
							choices: [
								{
									id: 'investigate',
									label: 'Offer to climb down and see what is wrong',
									preconditions: [{ type: 'trait', key: 'strength', min: 4 }],
									consequences: [
										{ type: 'stat', target: 'strength', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 2 },
										{ type: 'world_fact', target: 'investigated_well', value: true }
									],
									exhaustionCost: 3,
									nextNodeId: 'down_the_well'
								},
								{
									id: 'organize_party',
									label: 'Suggest organizing a work party to dig deeper',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 1 },
										{ type: 'world_fact', target: 'well_work_party', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: 'work_party'
								},
								{
									id: 'buy_from_merchant',
									label: 'Go see {merchant.name} about buying water for today',
									consequences: [
										{ type: 'faction', target: 'merchant_guild', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'merchant_deal'
								}
							]
						},
						down_the_well: {
							id: 'down_the_well',
							text: 'You descend on a rope. The stone walls are damp but not wet — the water table has simply dropped. At the bottom, you find something lodged in a crack: a bundle of cloth, deliberately stuffed to block a secondary channel. Someone did this on purpose.',
							choices: [
								{
									id: 'clear_it',
									label: 'Clear the blockage and climb back up',
									consequences: [
										{ type: 'faction', target: 'village_folk', value: 2 },
										{ type: 'world_fact', target: 'well_restored', value: true },
										{ type: 'world_fact', target: 'well_sabotaged', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: null
								},
								{
									id: 'leave_it_as_evidence',
									label: 'Leave it in place and report to the guard first',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 2 },
										{ type: 'world_fact', target: 'well_sabotaged', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						work_party: {
							id: 'work_party',
							text: 'By midday you have assembled six neighbors with shovels and strong backs. {elder.name} coordinates. The work is heavy and slow, but communal. By evening the well is three feet deeper and beginning to fill.',
							choices: [
								{
									id: 'stay_til_done',
									label: 'Stay until the work is finished',
									consequences: [
										{ type: 'stat', target: 'strength', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 2 },
										{ type: 'world_fact', target: 'well_restored', value: true }
									],
									exhaustionCost: 3,
									nextNodeId: null
								},
								{
									id: 'leave_early',
									label: 'Head home when your back gives out',
									consequences: [
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						merchant_deal: {
							id: 'merchant_deal',
							text: '{merchant.name} already has barrels on a cart, ready to sell. "Terrible tragedy," they say, not looking terribly troubled. "Supply and demand." They name a price that is almost insultingly high.',
							choices: [
								{
									id: 'pay_it',
									label: 'Pay what they ask — the town needs water',
									consequences: [
										{ type: 'faction', target: 'village_folk', value: 1 },
										{ type: 'faction', target: 'merchant_guild', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'haggle_hard',
									label: 'Refuse to be gouged — negotiate a fair price',
									preconditions: [{ type: 'skill', key: 'haggling' }],
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 2 },
										{ type: 'world_fact', target: 'haggled_water_price', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'festival_approaches',
					name: 'A Festival Approaches',
					tags: ['social', 'commerce'],
					preconditions: [],
					roles: [
						{
							id: 'organizer',
							label: 'Festival Organizer',
							traitRequirements: { charisma: { min: 4 } }
						},
						{
							id: 'vendor',
							label: 'A Vendor Setting Up',
							archetypeFilter: ['merchant']
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'The square is half-transformed with bunting and stalls. {organizer.name} rushes past you with an armful of lanterns, then stops. "You! Can you spare an hour? We are short-handed and the lighting needs to go up before dark."',
							choices: [
								{
									id: 'help_lighting',
									label: 'Help string the lanterns',
									consequences: [
										{ type: 'relationship', target: '{organizer.id}', value: 2, axis: 'affection' },
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 2,
									nextNodeId: 'lanterns_up'
								},
								{
									id: 'browse_vendors',
									label: 'Excuse yourself and browse the vendors arriving',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'vendors_row'
								}
							]
						},
						lanterns_up: {
							id: 'lanterns_up',
							text: 'You spend the afternoon on ladders. When the lanterns finally blaze at dusk, {organizer.name} stands back and lets out a long breath. "Every year I swear I will get more help in advance," they laugh. "Every year." They press a warm meal ticket into your hand.',
							choices: [
								{
									id: 'use_meal',
									label: 'Cash in the meal ticket tonight',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								},
								{
									id: 'give_meal_away',
									label: 'Give it to the first hungry-looking child you see',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 2 },
										{ type: 'faction', target: 'village_folk', value: 2 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						},
						vendors_row: {
							id: 'vendors_row',
							text: '{vendor.name} is unloading crates with practiced efficiency. "First time at this market," they say when you stop to look. "Heard the festival crowd is good. Brought things you will not find elsewhere." They gesture at a crate sealed with wax.',
							choices: [
								{
									id: 'ask_about_wax_crate',
									label: 'Ask what is in the sealed crate',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								},
								{
									id: 'buy_something_ordinary',
									label: 'Buy something ordinary and move on',
									consequences: [
										{ type: 'faction', target: 'merchant_guild', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						}
					}
				},
				{
					id: 'night_watch',
					name: 'Night Watch',
					tags: ['action', 'social', 'danger'],
					preconditions: [],
					roles: [
						{
							id: 'watch_captain',
							label: 'The Watch Captain',
							archetypeFilter: ['soldier'],
							factionRequirements: ['town_guard']
						},
						{
							id: 'watch_partner',
							label: 'Your Watch Partner',
							archetypeFilter: ['soldier', 'merchant']
						}
					],
					entryNodeId: 'start',
					nodes: {
						start: {
							id: 'start',
							text: 'The town watch is short-staffed. {watch_captain.name} asks if you will take a shift — four hours on the east wall with {watch_partner.name}. The night is clear, cold, and apparently quiet. Apparently.',
							choices: [
								{
									id: 'take_the_watch',
									label: 'Agree to take the shift',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 1 },
										{ type: 'relationship', target: '{watch_captain.id}', value: 1, axis: 'trust' }
									],
									exhaustionCost: 2,
									nextNodeId: 'on_the_wall'
								},
								{
									id: 'decline',
									label: 'Decline — you have your own affairs to attend to',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: -1 }
									],
									exhaustionCost: 0,
									nextNodeId: null
								}
							]
						},
						on_the_wall: {
							id: 'on_the_wall',
							text: 'The first two hours pass without event. {watch_partner.name} tells you about their childhood in a city you have never visited. Then, around the third hour, you both see it: a light moving in the lower fields, slow and deliberate. No lantern swings like that.',
							choices: [
								{
									id: 'raise_alarm',
									label: 'Call it in immediately — ring the watch bell',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 2 },
										{ type: 'world_fact', target: 'raised_night_alarm', value: true }
									],
									exhaustionCost: 1,
									nextNodeId: 'alarm_raised'
								},
								{
									id: 'investigate_quietly',
									label: 'Signal {watch_partner.name} and go investigate quietly',
									preconditions: [{ type: 'trait', key: 'cunning', min: 4 }],
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'investigated_night_light', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: 'into_the_dark'
								},
								{
									id: 'watch_and_wait',
									label: 'Stay still and watch where the light goes',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: 'watched_the_light'
								}
							]
						},
						alarm_raised: {
							id: 'alarm_raised',
							text: 'The bell wakes half the town. The guard pours out. By the time they reach the field, there is nothing — just trampled grass in a rough circle. {watch_captain.name} examines the marks, says nothing for a long time. "Good that you called it in," they say finally. "Good."',
							choices: [
								{
									id: 'help_search',
									label: 'Join the search of the surrounding area',
									consequences: [
										{ type: 'stat', target: 'strength', value: 1 },
										{ type: 'faction', target: 'town_guard', value: 1 }
									],
									exhaustionCost: 2,
									nextNodeId: null
								},
								{
									id: 'return_to_post',
									label: 'Return to the wall — your watch is not finished',
									consequences: [
										{ type: 'relationship', target: '{watch_captain.id}', value: 2, axis: 'trust' }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						into_the_dark: {
							id: 'into_the_dark',
							text: 'You and {watch_partner.name} move low through the grass. The light is a hooded lantern, held by a single figure who is burying something in the field. They do not hear you until you are very close. When they turn, their face is familiar — someone you have seen in town.',
							choices: [
								{
									id: 'confront_figure',
									label: 'Step forward and demand to know what they are doing',
									preconditions: [{ type: 'trait', key: 'strength', min: 4 }],
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'world_fact', target: 'confronted_night_figure', value: true }
									],
									exhaustionCost: 2,
									nextNodeId: null
								},
								{
									id: 'observe_and_report',
									label: 'Back away quietly and report what you saw',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 2 },
										{ type: 'stat', target: 'cunning', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						},
						watched_the_light: {
							id: 'watched_the_light',
							text: 'The light moves in a slow arc, then goes out. You mark the spot mentally. In the morning, you could check it in daylight when it is safer — or forget it entirely. {watch_partner.name} says nothing, watching your face.',
							choices: [
								{
									id: 'check_in_morning',
									label: 'Mark the spot and plan to check at first light',
									consequences: [
										{ type: 'stat', target: 'cunning', value: 1 },
										{ type: 'world_fact', target: 'marked_night_spot', value: true }
									],
									exhaustionCost: 0,
									nextNodeId: null
								},
								{
									id: 'report_then_forget',
									label: 'Report it to {watch_captain.name} and let the guard handle it',
									consequences: [
										{ type: 'faction', target: 'town_guard', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
								}
							]
						}
					}
				}
			],
			locations: [
				{
					id: 'tavern',
					name: 'Tavern',
					tags: ['social', 'rest', 'information'],
					eventTags: ['social', 'romance', 'intrigue'],
					archetypeIds: ['merchant', 'soldier'],
					flavorTexts: ['The fire crackles low.', 'A bard tunes a lute in the corner.']
				},
				{
					id: 'market_quarter',
					name: 'Market Quarter',
					tags: ['commerce', 'social', 'crafting'],
					eventTags: ['action', 'crafting', 'social'],
					archetypeIds: ['merchant', 'blacksmith'],
					flavorTexts: ['Stalls line both sides of the street.', 'The air smells of fresh bread and leather.']
				}
			],
			questlines: [
				{
					id: 'demon_invasion',
					name: 'The Demon Invasion',
					description: 'A demon lord threatens the realm. Heroes rally, borders fall, and the final siege approaches.',
					stages: [
						{
							id: 'gathering',
							name: 'The Demon Gathers Forces',
							description: 'Rumors of darkness in the borderlands. Life is mostly normal, but tension rises.',
							worldConditions: { dangerLevel: 'low', tradeDisruption: false },
							advancementTriggers: [
								{ type: 'counter', key: 'border_incidents', threshold: 5 }
							],
							regressionTriggers: [],
							flavorShifts: { tavern: 'Travelers speak of strange sightings near the border.' }
						},
						{
							id: 'heroes_rally',
							name: 'Heroes Rally',
							description: 'The threat is undeniable. Warriors and adventurers head to the border.',
							worldConditions: { dangerLevel: 'medium', tradeDisruption: true },
							advancementTriggers: [
								{ type: 'counter', key: 'border_defense', threshold: 10 }
							],
							regressionTriggers: [
								{ type: 'counter', key: 'border_failures', threshold: 5 }
							],
							flavorShifts: { tavern: 'Recruitment posters cover every wall. The mood is grim.' }
						},
						{
							id: 'border_falls',
							name: 'The Border Falls',
							description: 'The border forts have fallen. Refugees stream inland. Danger is everywhere.',
							worldConditions: { dangerLevel: 'high', tradeDisruption: true },
							advancementTriggers: [
								{ type: 'counter', key: 'siege_preparation', threshold: 15 }
							],
							regressionTriggers: [],
							flavorShifts: { tavern: 'Refugees crowd every corner. Food is scarce.' }
						},
						{
							id: 'final_siege',
							name: 'The Final Siege',
							description: 'The demon army is at the gates. Everything comes down to this.',
							worldConditions: { dangerLevel: 'extreme', tradeDisruption: true },
							advancementTriggers: [],
							regressionTriggers: [],
							flavorShifts: { tavern: 'The tavern is silent. Everyone waits.' }
						}
					]
				}
			]
		};
	}

	function startNewWorld() {
		const blocks = getDemoWorldBlocks();
		const state = initializeWorldState(blocks);
		worldBlocks.set(blocks);
		worldState.set(state);
		saveWorldBlocks(blocks);
		saveWorldState(state);
		goto('/journal/setup');
	}

	function continueWorld() {
		const state = loadWorldState();
		const blocks = loadWorldBlocks();
		if (state && blocks) {
			worldState.set(state);
			worldBlocks.set(blocks);
			goto('/journal/setup');
		}
	}
</script>

<div class="landing">
	<div class="landing-inner">
		<h1 class="title">Journal RPG</h1>
		<p class="tagline">A procedural RPG where you live out the days of background characters.</p>
		<p class="description">
			Each session, you step into the life of a merchant, blacksmith, or soldier in a world
			shaped by your choices. Events unfold around you. Questlines rise and fall. No hero's
			journey — just ordinary lives in extraordinary times.
		</p>
		<div class="actions">
			<button class="btn btn-primary" onclick={startNewWorld}>
				Start New World
			</button>
			{#if hasSavedWorld}
				<button class="btn btn-secondary" onclick={continueWorld}>
					Continue World
				</button>
			{/if}
		</div>
		<p class="world-name">World: Ironhaven</p>
		<a href="/settings" class="settings-link">Settings</a>
		<a href="/timeline" class="settings-link">World Inspector</a>
	</div>
</div>

<style>
	.landing {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.landing-inner {
		max-width: 560px;
		text-align: center;
	}

	.title {
		font-family: var(--journal-font);
		font-size: 3.5rem;
		color: var(--journal-accent);
		margin-bottom: 0.5rem;
		letter-spacing: 0.04em;
		text-shadow: 0 2px 8px rgba(0,0,0,0.5);
	}

	.tagline {
		font-size: 1.1rem;
		color: var(--session-end-text);
		margin-bottom: 1.5rem;
		opacity: 0.8;
		font-style: italic;
	}

	.description {
		font-size: 0.95rem;
		line-height: 1.8;
		color: var(--session-end-text);
		opacity: 0.7;
		margin-bottom: 2.5rem;
		border: 1px solid var(--session-end-border);
		background: var(--session-end-card-bg);
		border-radius: 6px;
		padding: 1.25rem 1.5rem;
	}

	.actions {
		display: flex;
		gap: 1rem;
		justify-content: center;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}

	.btn {
		padding: 0.75rem 2rem;
		border: none;
		border-radius: 4px;
		font-family: var(--journal-font);
		font-size: 1rem;
		cursor: pointer;
		transition: opacity 0.15s, transform 0.1s;
		letter-spacing: 0.03em;
	}

	.btn:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.btn:active {
		transform: translateY(0);
	}

	.btn-primary {
		background-color: var(--journal-accent);
		color: #fff8ee;
		font-weight: bold;
	}

	.btn-secondary {
		background-color: transparent;
		color: var(--session-end-text);
		border: 1px solid var(--session-end-border);
	}

	.world-name {
		font-size: 0.8rem;
		opacity: 0.4;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.settings-link {
		display: inline-block;
		margin-top: 1.25rem;
		font-size: 0.8rem;
		color: var(--session-end-text);
		opacity: 0.35;
		text-decoration: none;
		letter-spacing: 0.06em;
		transition: opacity 0.15s;
	}

	.settings-link:hover {
		opacity: 0.7;
	}
</style>
