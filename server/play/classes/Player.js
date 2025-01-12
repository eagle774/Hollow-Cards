const cardList = require('../data/cards.js').cardList
const Card = require('./Card.js').Card
const ListenerReceiver = require('./ListenerReceiver.js').ListenerReceiver
const ListenerEmitter = require('./ListenerEmitter.js').ListenerEmitter
const util = require('../../util.js')
class Player {
    constructor(id, game, deck, name) {
        this.id = id
        this.game = game
        this.deck = util.convertToDeck(deck.cards)
        this.name = name
        this.listenerEmitter = new ListenerEmitter(this.game)
        this.listenerReceiver = new ListenerReceiver()
        this._hp = 30
        this._geo = 0
        this._soul = 0
        this.geoNext = 1
        this.hand = []
        this.factions = this.deck.factions
        this.animationsToSend = []
        this.numOfCardsMax = 10
        this.fatigueNext = 1
        this.webSocket = false
        this.validTargets = null
        this.targetDemandingCard = null
        this.animationsLocked = false
        this.hpMax = 30
        this.slots = [null, null, null, null, null, null, null]
        this.addAnimation("setID", { id: this.id }, 0)
        this.state = "default"
        this.chooseCards = []
        this.debug = false
        this.listenerReceiver.addEventHandler(
            "PlayerIncreaseSoul",
            (data) => { this.soul += 1 },
            (data) => { return ["allyDied", "allyToAttack"].includes(data.name) },
            this.listenerEmitter
        )
    }
    beginGame() {
        for (let i = 0; i < this.deck.length; i++) {
            this.deck[i] = new Card(this.deck[i], this.id, this.game, "deck")
        }
        util.shuffle(this.deck)
        this.draw(3, true)
    }
    set geo(value) {
        this._geo = value
        this.addAnimation("updateAllyGeo", { value: this._geo }, 0)
        this.addEnemyAnimation("updateEnemyGeo", { value: this._geo }, 0)
    }
    get geo() {
        return this._geo
    }
    set soul(value) {
        this._soul = value
        this.addAnimation("updateAllySoul", { value: this._soul }, 0)
        this.addEnemyAnimation("updateEnemySoul", { value: this._soul }, 0)
    }
    get soul() {
        return this._soul
    }
    get hp() {
        return this._hp
    }
    set hp(value) {
        this._hp = value
        this.addAnimation("updateAllyHealth", { value: this._hp + "/" + this.hpMax, amount: this._hp }, 0)
        this.addEnemyAnimation("updateEnemyHealth", { value: this._hp + "/" + this.hpMax, amount: this._hp }, 0)
    }
    get enemyPlayer() {
        return this.game.players[+!this.id]
    }
    get hasEmptySlot() {
        for (let i = 0; i < 7; i++) {
            if (this.slots[i] == null) {
                return true
            }
        }
        return false
    }
    get noCharacters() {
        for (let i = 0; i < 7; i++) {
            if (this.slots[i] != null) {
                return false
            }
        }
        return true
    }
    addEnemyAnimation(type, data, time) {
        if (!this.game.players) {
            return
        }
        this.enemyPlayer.addAnimation(type, data, time)
    }
    addDataAnimations() {
        this.addAnimation("updateAllyGeo", { value: this.geo })
        this.addAnimation("updateEnemyGeo", { value: this.enemyPlayer.geo })
        this.addAnimation("updateAllySoul", { value: this.soul })
        this.addAnimation("updateEnemySoul", { value: this.enemyPlayer.soul })
        this.addAnimation("updateAllyCards", { value: this.hand.length })
        this.addAnimation("updateEnemyCards", { value: this.enemyPlayer.hand.length })
        this.addAnimation("updateAllyHealth", { value: this.hp + "/" + this.hpMax })
        this.addAnimation("updateEnemyHealth", { value: this.enemyPlayer.hp + "/" + this.enemyPlayer.hpMax })
        this.addAnimation("updateAllyName", { value: this.name })
        this.addAnimation("updateEnemyName", { value: this.enemyPlayer.name })
    }
    engageWebsocket(socket) {
        this.webSocket = socket
        this.webSocket.on('message', (message) => { this.handleSocketMessage(message) })
    }
    sendFullGamestate() {
        this.addAnimation("setID", { id: this.id })
        for (let i = 0; i < this.enemyPlayer.slots.length; i++) {
            let slot = this.enemyPlayer.slots[i]
            if (slot !== null) {
                this.addAnimation("summonCharacter", { card: slot.getSendableCopy(), slot: i })
            }
        }
        for (let i = 0; i < this.slots.length; i++) {
            let slot = this.slots[i]
            if (slot !== null) {
                this.addAnimation("summonCharacter", { card: slot.getSendableCopy(), slot: i })
            }
        }
        for (let i = 0; i < this.hand.length; i++) {
            let card = this.hand[i]
            this.addAnimation("addCardHand", { card: card.getSendableCopy() })
        }
        this.addAnimation("updateAllyGeo", { value: this.geo })
        this.addAnimation("updateEnemyGeo", { value: this.enemyPlayer.geo })
        this.addAnimation("updateAllySoul", { value: this.soul })
        this.addAnimation("updateEnemySoul", { value: this.enemyPlayer.soul })
        this.addAnimation("updateAllyCards", { value: this.hand.length })
        this.addAnimation("updateEnemyCards", { value: this.enemyPlayer.hand.length })
        this.addAnimation("updateAllyHealth", { value: this.hp + "/" + this.hpMax })
        this.addAnimation("updateEnemyHealth", { value: this.enemyPlayer.hp + "/" + this.enemyPlayer.hpMax })
        this.addAnimation("updateAllyName", { value: this.name })
        this.addAnimation("updateEnemyName", { value: this.enemyPlayer.name })
        if (this.state == "waitingForTarget") {
            if (this.onCancelChoose != null) {
                this.addAnimation("getTargetCancellable", { validTargets: this.validTargets, card: this.targetDemandingCard.getSendableCopy() }, 0)
            } else {
                this.addAnimation("getTargetNotCancellable", { validTargets: this.validTargets }, 0)
            }
        } else if (this.state == "waitingForChoose") {
            this.addAnimation("getChoose", { chooseCards: this.chooseCards }, 0)
        }
        if (this.game.whosTurnCurrent == this.id) {
            this.addAnimation("beginTurn", {})
        }
        this.sendAnimations()
    }
    handleSocketMessage(message) {
        //Handles messages from the player.
        if (message == 'ping') {
            this.beenPinged = true
            return
        }
        if (message == 'debugToggle') {
            this.debug = !this.debug
        }
        if (this.debug) {
            console.log(message)
        }
        if (!this.game.started) {
            return false
        }
        try {
            message = JSON.parse(message)
            if (this.state == "waitingForChoose") {
                if (message.type == "chosenCard") {
                    if (message.chosen >= 0 && message.chosen < this.chooseCards.length) {
                        let save = this.onChosenCard
                        let save2 = this.chooseCards
                        this.chooseCards = null
                        this.state = "default"
                        this.onChosenCard = null
                        this.addAnimation("clearChooseCardSelection", {})
                        save(message.chosen, save2)
                        this.game.sendAnimations()
                    }
                }
            } else if (this.state == "waitingForTarget") {
                switch (message.type) {
                    case "targetChosen":
                        if (this.isValidTarget(this.validTargets, message.target)) {
                            let save = this.onTargetChosen
                            this.state = "default"
                            this.onCancelChoose = null
                            this.onTargetChosen = null
                            this.validTargets = null
                            this.addAnimation("clearTargetSelection", {})
                            save(this.parseTarget(message.target))
                            this.game.sendAnimations()
                        }
                        break;
                    case "cancelChoose":
                        this.onCancelChoose()
                        this.state = "default"
                        this.onCancelChoose = null
                        this.onTargetChosen = null
                        this.validTargets = null
                        this.addAnimation("clearTargetSelection", {})
                        this.game.sendAnimations()
                        break;
                    default:
                        break;
                }
            } else {
                switch (message.type) {
                    case "endTurn":
                        if (this.game.whosTurnCurrent == this.id) {
                            this.game.nextTurn()
                            this.game.sendAnimations()
                        }
                        break;
                    case "playCharacterCard":
                        this.playCharacter(message.position, message.slotNumber)
                        this.game.sendAnimations()
                        break;
                    case "characterActs":
                        console.log(message)
                        this.characterActs(message.position, message.slotNumber,message.ally)
                        this.game.sendAnimations()
                        break;
                    case "playSpellCard":
                        this.playSpell(message.position)
                        this.game.sendAnimations()
                        break;
                    case "characterAttack":
                        if (message.initiator.team == this.id) {
                            let attackingMonster = this.slots[message.initiator.slot]
                            let defendingMonster = this.game.players[message.target.team].slots[message.target.slot]
                            this.game.addToStack(() => { attackingMonster.attackMonster(defendingMonster, false) })
                            this.game.sendAnimations()
                        }
                        break
                    case "playerAttack":
                        if (message.initiator.team == this.id) {
                            let attackingMonster = this.game.players[this.id].slots[message.initiator.slot]
                            attackingMonster.attackPlayer(this.game.players[message.target], false)
                            this.game.sendAnimations()
                        }
                        break
                    default:
                        break;
                }
            }
        } catch (e) {
            console.log(message)
            console.log(e)
        }
        //this.webSocket.send(message)
    }
    parseTarget(target) {
        if (target.location == 'player') {
            return this.game.players[target.player]
        } else if (target.location == 'allySlots') {
            return this.slots[target.pos]
        } else if (target.location == 'enemySlots') {
            return this.enemyPlayer.slots[target.pos]
        }
    }
    isValidTarget(targetList, target) {
        if (target.location == 'player') {
            return target.player == this.id ? targetList.allyPlayer : targetList.enemyPlayer
        } else if (target.location == 'allySlots') {
            return targetList.allySlots.includes(target.pos)
        } else if (target.location == 'enemySlots') {
            return targetList.enemySlots.includes(target.pos)
        }
    }
    flipTargets(target) {
        let newTargets = { allySlots: target.enemySlots, enemySlots: target.allySlots, allyPlayer: target.enemyPlayer, enemyPlayer: target.allyPlayer, allyHand: target.enemyHand }
        return newTargets
    }
    sendAnimations() {
        if (this.animationsToSend.length == 0) {
            return false
        }
        let allySlots = []
        for (let i = 0; i < this.slots.length; i++) {
            if (this.slots[i] != null) {
                allySlots.push(this.slots[i].getSendableCopy())
            } else {
                allySlots.push(null)
            }
        }
        let enemySlots = []
        for (let i = 0; i < this.enemyPlayer.slots.length; i++) {
            if (this.enemyPlayer.slots[i] != null) {
                enemySlots.push(this.enemyPlayer.slots[i].getSendableCopy())
            } else {
                enemySlots.push(null)
            }
        }
        let hand = []
        for (let i = 0; i < this.hand.length; i++) {
            hand.push(this.hand[i].getSendableCopy())
        }
        for (let i = 0; i < this.animationsToSend.length; i++) {
            if (this.animationsToSend[i].type == "fake") {
                this.animationsToSend = this.animationsToSend.slice(0, i).concat(this.animationsToSend.slice(i + 1))
                i -= 1
            }
        }
        this.webSocket.send(
            JSON.stringify(
                {
                    animationList: this.animationsToSend,
                    cardData: {
                        allySlots,
                        enemySlots,
                        hand,
                    }
                }
            )
        )
        this.animationsToSend = []
    }
    addAnimation(type, data, time = 0) {
        if (this.animationsLocked) {
            return
        }
        let animation = { type, data, time }
        if (type == "awaitDeath") {
            let foundPrevAnim = true
            for (let i = this.animationsToSend.length - 1; i >= 0; i--) {
                let curAnim = this.animationsToSend[i]
                if (curAnim.type == "awaitDeath") {
                    curAnim.type = "multiAwaitDeath"
                    curAnim.data.allyList = [curAnim.data.ally, data.ally]
                    curAnim.data.slotList = [curAnim.data.slot, data.slot]
                    delete curAnim.data.ally
                    delete curAnim.data.slot
                    //move this to the end
                    this.animationsToSend = (this.animationsToSend.slice(0, i).concat(this.animationsToSend.slice(i + 1, this.animationsToSend.length))).concat(curAnim)
                    break
                } else if (curAnim.type == "multiAwaitDeath") {
                    curAnim.data.allyList.push(data.ally)
                    curAnim.data.slotList.push(data.slot)
                    //move this to the end
                    this.animationsToSend = (this.animationsToSend.slice(0, i).concat(this.animationsToSend.slice(i + 1, this.animationsToSend.length))).concat(curAnim)
                    break
                } else if ((curAnim.type != "updateBoardCardData" && curAnim.type != "updateHandCardData") || i == 0) {
                    foundPrevAnim = false
                    break
                }
            }
            if (!foundPrevAnim) {
                this.animationsToSend.push(animation)
            }
        } else {
            this.animationsToSend.push(animation)
        }
    }
    addDualAnimation(type, data, time = 0) {
        this.addAnimation(type, data, time, true)
        let newData = {};
        if (data.ally != undefined) {
            for (const [key, value] of Object.entries(data)) {
                newData[key] = value
            }
            newData.ally = !data.ally
            this.enemyPlayer.addAnimation(type, newData, time, true)
        } else {
            this.enemyPlayer.addAnimation(type, data, time, true)
        }
    }
    startTurn() {
        this.addAnimation("beginTurn", {}, 0)
        this.geo += this.geoNext
        this.geoMax = this.geoNext
        if (this.geoNext < 10) {
            this.geoNext++
        }
        this.draw(1)
        for (let i = 0; i < 7; i++) {
            if (this.slots[i] != null) {
                this.slots[i].turnStart(this.game)
            }
        }
    }
    endTurn() {
        this.addAnimation("endTurn", {}, 0)
        this.listenerEmitter.emitPassiveEvent({}, "triggerTurnEndEvents")
    }
    shuffleDeck() {
        util.shuffle(this.deck)
    }
    draw(amount, override) {
        if (amount > 1) {
            for (let i = 0; i < amount; i++) {
                this.draw(1, override)
            }
        } else {
            if (this.deck.length > 0) {
                if (this.numOfCardsMax > this.hand.length) {
                    let cardToHand = this.deck.splice(0, 1)[0]
                    this.hand.push(cardToHand)
                    if (!override) {
                        this.addAnimation("addCardHand", { card: cardToHand.getSendableCopy() }, 100)
                    } else {
                        this.addAnimation("addCardHand", { card: cardToHand.getSendableCopy() }, 0)
                    }
                    this.addAnimation("updateAllyCards", { value: this.hand.length }, 0)
                    this.addEnemyAnimation("updateEnemyCards", { value: this.hand.length }, 0)
                    cardToHand.zone = "hand"
                } else {
                    let burntCard = this.deck.splice(0, 1)[0]
                    this.addAnimation("burnCard", { card: burntCard.getSendableCopy() }, 400)
                    this.addEnemyAnimation("burnCard", { card: burntCard.getSendableCopy() }, 400)
                    this.addAnimation("clearBurntCard", {}, 0)
                    this.addEnemyAnimation("clearBurntCard", {}, 0)
                }
            } else {
                this.takeDamage(null, this.fatigueNext, this.game)
                this.fatigueNext += 1
            }
        }
    }
    playCharacter(cardPos, slotPos) {
        if (this.slots[slotPos] != null || slotPos >= 7 || cardPos >= this.hand.length || slotPos < 0) {
            return
        }
        let card = this.hand[cardPos]
        if (!card.isPlayable) {
            return;
        }
        if (card.requiresTarget && !util.targetsEmpty(card.getValidTargets())) {
            this.hand.splice(cardPos, 1)
            this.addAnimation("removeCardHand", { cardPos })
            this.addAnimation("updateAllyCards", { value: this.hand.length })
            this.waitForTargetCancellable(
                card,
                (target) => {
                    this.geo -= card.outgoingGeoCost
                    this.addEnemyAnimation("updateEnemyCards", { value: this.hand.length })
                    this.summonCharacter(card, slotPos, true, target)
                },
                (target) => {
                    this.hand.splice(cardPos, 0, card)
                    this.addAnimation("updateAllyCards", { value: this.hand.length })
                    this.addAnimation("addCardHandPos", { pos: cardPos, card: card.getSendableCopy() })
                }
            )
            return
        } else {
            this.geo -= card.outgoingGeoCost
            this.hand.splice(cardPos, 1)
            this.addAnimation("removeCardHand", { cardPos })
            this.addAnimation("updateAllyCards", { value: this.hand.length })
            this.addEnemyAnimation("updateEnemyCards", { value: this.hand.length })
            this.summonCharacter(card, slotPos, true)
        }
        this.listenerEmitter.emitPassiveEvent({ card: card }, "allyCardPlayed")
    }
    characterActs(cardPos, slotPos, ally) {
        if ((this.slots[slotPos] == null && ally) || (this.enemyPlayer.slots[slotPos] == null && !ally) || slotPos >= 7 || cardPos >= this.hand.length||slotPos<=0) {
            return
        }
        let card = this.hand[cardPos]
        let target = ally?this.slots[slotPos]:this.enemyPlayer.slots[slotPos]
        if (!card.canAct) {
            return;
        }
        this.geo -= card.actCost
        this.addAnimation("showTargeted", { targets: this.calcActTargets(target)}, 0)
        this.addEnemyAnimation("showTargeted", { targets: this.flipTargets(this.calcActTargets(target)) }, 0)
        this.addAnimation("triggerEffect", { card: card.getSendableCopy() }, 700)
        this.addEnemyAnimation("triggerEffect", { card: card.getSendableCopy() }, 700)
        card.listenerEmitter.emitPassiveEvent({ target }, "triggerActEvents");
        card.acted = true
        this.listenerEmitter.emitPassiveEvent({ card: card }, "allyCardActed")
    }
    calcActTargets(target) {
        return {
            allyPlayer: false, enemyPlayer: false,
            allySlots: target.team == this.id ? [target.slot] : [],
            enemySlots: target.team != this.id ? [target.slot] : [],
        }
    }
    playSpell(cardPos) {
        if (cardPos >= this.hand.length) {
            return
        }
        let card = this.hand[cardPos]
        if (!card.isPlayable) {
            return;
        }
        if (card.requiresTarget) {
            this.hand.splice(cardPos, 1)
            this.addAnimation("removeCardHand", { cardPos })
            this.addAnimation("updateAllyCards", { value: this.hand.length })
            this.waitForTargetCancellable(
                card,
                (target) => {
                    this.geo -= card.outgoingGeoCost
                    this.soul -= card.outgoingSoulCost
                    this.addAnimation("updateAllyCards", { value: this.hand.length })
                    this.addEnemyAnimation("updateEnemyCards", { value: this.hand.length })
                    this.castSpell(card, true, target)
                },
                (target) => {
                    this.hand.splice(cardPos, 0, card)
                    this.addAnimation("updateAllyCards", { value: this.hand.length })
                    this.addAnimation("addCardHandPos", { pos: cardPos, card: card.getSendableCopy() })
                }
            )
            return
        } else {
            this.geo -= card.outgoingGeoCost
            this.soul -= card.outgoingSoulCost
            this.hand.splice(cardPos, 1)
            this.addAnimation("removeCardHand", { cardPos }, 0)
            this.addAnimation("updateAllyCards", { value: this.hand.length }, 0)
            this.addEnemyAnimation("updateEnemyCards", { value: this.hand.length })
            this.castSpell(card, true)
        }
        this.listenerEmitter.emitPassiveEvent({ card: card }, "allyCardPlayed")
    }
    castSpell(spell, played = false, target = null) {
        spell.zone = "void"
        let spellTargets = spell.calcTargets(target)
        if (spellTargets != null) {
            this.addAnimation("showTargeted", { targets: spellTargets }, 0)
            this.addEnemyAnimation("showTargeted", { targets: this.flipTargets(spellTargets) }, 0)
        }
        this.addAnimation("triggerEffect", { card: spell.getSendableCopy() }, 700)
        this.addEnemyAnimation("triggerEffect", { card: spell.getSendableCopy() }, 700)
        this.game.stackClosed = true
        spell.triggerEffect(target)
        this.game.stackClosed = false
        this.listenerEmitter.emitPassiveEvent({ spell, played }, "spellCast")
    }
    summonCharacter(card, slot = null, played = false, target = null) {
        if (slot == null) {
            for (let i = 0; i < this.slots.length; i++) {
                if (this.slots[i] == null) {
                    slot = i
                    break
                }
            }
        }
        if (slot == null || this.slots[slot] != null || slot >= 7 || slot < 0) {
            return false
        }
        this.slots[slot] = card
        card.setupSummon(slot)
        card.onSummon(played, target)
        return true
    }
    takeDamage(source, amount) {
        if (amount <= 0) {
            return
        }
        this.hp -= amount
        if (this.hp <= 0) {
            this.game.win(+!this.id)
        }
    }
    conjureNewCard(cardName) {
        if (this.numOfCardsMax == this.hand.length) {
            return
        }
        let card = new Card(cardName, this.id, this.game, "hand")
        this.hand.push(card)
        this.addAnimation("addCardHand", { card: card.getSendableCopy() }, 100)
        this.addAnimation("updateAllyCards", { value: this.hand.length }, 0)
        this.addEnemyAnimation("updateEnemyCards", { value: this.hand.length }, 0)
        return card
    }
    //Invoke - Conjure and Summon
    invokeCharacter(cardName) {
        if (!this.hasEmptySlot)
            return
        if (cardList[cardName].type != "character")
            return
        let card = new Card(cardName, this.id, this.game, "void")
        this.summonCharacter(card)
        return card
    }
    waitForTargetCancellable(card, onTargetChosen, onCancelChoose) {
        this.validTargets = card.getValidTargets()
        this.game.listenerEmitter.emitModifiableEvent({ card }, "cardModifyValidTargets", this.validTargets)
        this.addAnimation("getTargetCancellable", { validTargets: this.validTargets, card: card.getSendableCopy() }, 0)
        this.state = "waitingForTarget"
        this.onCancelChoose = onCancelChoose
        this.onTargetChosen = onTargetChosen
        this.targetDemandingCard = card
    }
    waitForTargetNotCancellable(getValidTargets, onTargetChosen) {
        this.validTargets = getValidTargets()
        if (util.targetsEmpty(this.validTargets)) {
            return
        }
        this.game.listenerEmitter.emitModifiableEvent({}, "modifyValidTargets", this.validTargets)
        this.addAnimation("getTargetNotCancellable", { validTargets: this.validTargets }, 0)
        this.state = "waitingForTarget"
        this.onTargetChosen = onTargetChosen
    }
    waitForChoose(chooseCards, onChosenCard) {
        this.chooseCards = chooseCards
        this.addAnimation("getChoose", { chooseCards: this.chooseCards }, 0)
        this.state = "waitingForChoose"
        this.onChosenCard = onChosenCard
    }
}
module.exports = { Player }
//NOTES: Playing a card that requires a target appears to not close the stack. Where is it being closed in the first place?