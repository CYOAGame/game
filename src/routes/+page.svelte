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
										{ type: 'relationship', target: '{bystander.id}', value: 3 },
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
										{ type: 'relationship', target: '{bystander.id}', value: 2 },
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
							text: 'The village square is strung with lanterns. The smell of roasted apples and spiced cider fills the air. {festival_organizer.name} waves you over.',
							choices: [
								{
									id: 'join_feast',
									label: 'Join the communal feast',
									consequences: [
										{ type: 'stat', target: 'charisma', value: 1 },
										{ type: 'faction', target: 'village_folk', value: 1 }
									],
									exhaustionCost: 1,
									nextNodeId: null
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
									nextNodeId: null
								},
								{
									id: 'barter',
									label: 'Try to barter for a good deal',
									preconditions: [{ type: 'skill', key: 'haggling' }],
									consequences: [
										{ type: 'faction', target: 'merchant_guild', value: 1 }
									],
									exhaustionCost: 2,
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
		goto('/journal');
	}

	function continueWorld() {
		const state = loadWorldState();
		const blocks = loadWorldBlocks();
		if (state && blocks) {
			worldState.set(state);
			worldBlocks.set(blocks);
			goto('/journal');
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
</style>
