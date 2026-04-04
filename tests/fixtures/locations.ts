import type { LocationType } from '../../src/lib/types/blocks';
import type { LocationInstance } from '../../src/lib/types/state';

export const tavernType: LocationType = {
	id: 'tavern',
	name: 'Tavern',
	tags: ['social', 'rest', 'information'],
	eventTags: ['social', 'romance', 'intrigue'],
	archetypeIds: ['merchant', 'soldier'],
	flavorTexts: ['The fire crackles low.', 'A bard tunes a lute in the corner.']
};

export const marketType: LocationType = {
	id: 'market_quarter',
	name: 'Market Quarter',
	tags: ['commerce', 'social', 'crafting'],
	eventTags: ['action', 'crafting', 'social'],
	archetypeIds: ['merchant', 'blacksmith'],
	flavorTexts: ['Stalls line both sides of the street.', 'The air smells of fresh bread and leather.']
};

export const allLocationTypes = [tavernType, marketType];

export const tavernInstance: LocationInstance = {
	id: 'rusty_flagon',
	typeId: 'tavern',
	name: 'The Rusty Flagon'
};

export const marketInstance: LocationInstance = {
	id: 'market_square',
	typeId: 'market_quarter',
	name: 'Ironhaven Market Square'
};

export const allLocationInstances = [tavernInstance, marketInstance];
