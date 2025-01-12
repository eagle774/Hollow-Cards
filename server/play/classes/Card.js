const cardList = require('../data/cards.js').cardList
const util = require('../../util.js')
const ListenerReceiver = require('./ListenerReceiver.js').ListenerReceiver
const ListenerEmitter = require('./ListenerEmitter.js').ListenerEmitter
class Card {
    constructor(name, team, game, zone) {
        this.name = name
        this.listenerEmitter = new ListenerEmitter(game)
        this.listenerReceiver = new ListenerReceiver()
        this.team = team
        this.constructorObject = Card
        this.slot = null
        this.statsSwapped = false
        this.game = game
        this.cardID = this.game.nextCardID
        this.damage = 0
        console.log(name)
        this.loadData(cardList[name])
        //HP after damage
        //orig means the base stats of the card, cur means current stats before aurs, outgoing means after all auras, public means what the client sees.
        if (this.type == "character") {
            this.curBaseHP = this.origHP
            this.curAttack = this.origAttack
            this.realHP = this.origHP
            this.attacking = false
            this.prevAttack = 0
            this.prevHP = 0
            this.prevKeywords = []
            this.summoningSick = true
            //canAttack: Can we attack?
            this.canAttack = true
            this.hasAttacked = false
            this.ableToAttack = {}
            this.outgoingStatsSwapped = this.statsSwapped
            if (this.canAct) {
                this.acted = false
            }
        }
        this._zone = "void"
        this.prevSoulCost = null
        this.prevGeoCost = null
        this.outgoingText = this.baseText
        //For spells/cards with effects that trigger before being in play. Keep in mind that listeners assigned here are active everywhere until removed: 
        //Dustpile, library, hand. Make sure you remove them when the card dies and check which zone it is in.

        if (this.type == "spell" && !this.triggerEffect) {
            this.triggerEffect = (() => { })
        }
        this.zone = zone
        if (this.onCardCreation) {
            this.game.addToStack(() => { this.onCardCreation() },"OnCardCreated"+name)
        }
    }
    get zone() {
        return this._zone
    }
    set zone(value) {
        let prevZone = this._zone
        this._zone = value
        this.listenerEmitter.emitPassiveEvent({ prevZone, newZone: this._zone }, "cardZoneChange");
    }
    get player() {
        return this.game.players[this.team]
    }
    get enemyPlayer() {
        return this.game.players[+!this.team]
    }
    get isPlayable() {
        if (this.zone != "hand") return false
        let playable = true
        if (this.player.geo < this.outgoingGeoCost || (this.player.soul < this.outgoingSoulCost && this.outgoingSoulCost != undefined)) {
            playable = false
        }
        playable = this.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardPlayable", playable)
        playable = this.game.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardPlayable", playable)
        //note that to prevent softlocks making a card unplayable if no targets comes after all modifyCardPlayables
        if (this.requiresTarget && this.type == "spell") {
            let targets = this.getValidTargets()
            if (util.targetsEmpty(targets)) {
                playable = false
            }
        }
        if (!this.player.hasEmptySlot && this.type == "character") {
            playable = false
        }
        return playable
    }
    get canAct() {
        if (this.zone != "hand") return false
        if (!this.hasAct) return false
        if(this.acted) return false
        let actable = true
        if (this.player.geo < this.actCost) {
            actable = false
        }
        actable = this.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardCanAct", actable)
        actable = this.game.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardCanAct", actable)
        //note that to prevent softlocks making a card unplayable if no targets comes after all modifyCardPlayables
        if (this.player.noCharacters && this.enemyPlayer.noCharacters) {
            return false
        }
        return actable
    }
    get outgoingGeoCost() {
        let cost = this.geoCost
        cost = this.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardGeoCost", cost)
        cost = this.game.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardGeoCost", cost)
        return cost
    }
    get outgoingSoulCost() {
        let cost = this.soulCost
        cost = this.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardSoulCost", cost)
        cost = this.game.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardSoulCost", cost)
        return cost
    }
    get outgoingBaseHP() {
        let hp = this.curBaseHP
        hp = this.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardHP", hp)
        hp = this.game.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardHP", hp)
        return hp
    }
    get outgoingHP() {
        return this.outgoingBaseHP - this.damage
    }
    get outgoingAttack() {
        let attack = this.curAttack
        attack = this.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardAttack", attack)
        attack = this.game.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardAttack", attack)
        return attack
    }
    get outgoingKeywords() {
        let keywords = this.baseKeywords
        keywords = this.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardKeywords", keywords)
        keywords = this.game.listenerEmitter.emitModifiableEvent({ card: this }, "modifyCardKeywords", keywords)
        keywords = util.stripDuplicates(keywords)
        return keywords
    }
    applyBuff(buff) {
        //yes, debuffs too.
        if (buff.hp) {
            this.curBaseHP += buff.hp
        }
        if (buff.attack) {
            this.curAttack += buff.attack
        }
        if (buff.geoCost) {
            this.geoCost += buff.geoCost
        }
        this.checkUpdates()
    }
    performSetup() {

    }
    //Character only
    attackMonster(target, override) {
        this.updateAttackable()
        if (!override && !this.canAttack) {
            return
        }
        if (!(target.team == this.team && this.ableToAttack.allySlots.includes(target.slot)) && !(target.team !== this.team && this.ableToAttack.enemySlots.includes(target.slot))) {
            return
        }
        this.attacking = "monster"
        this.player.listenerEmitter.emitPassiveEvent({ monster: this, targetType: "monster", target }, "allyToAttack")
        this.player.addAnimation("displayAttackOverlay", { ally: true, slot: this.slot }, 0)
        this.enemyPlayer.addAnimation("displayAttackOverlay", { ally: false, slot: this.slot }, 0)
        this.game.players[target.team].addAnimation("displayDefendOverlay", { ally: true, slot: target.slot }, 0)
        this.game.players[+!target.team].addAnimation("displayDefendOverlay", { ally: false, slot: target.slot }, 0)
        //pause
        this.player.addAnimation("wait", {}, 400)
        this.enemyPlayer.addAnimation("wait", {}, 400)

        this.player.addAnimation("hideAttackOverlay", {}, 0)
        this.enemyPlayer.addAnimation("hideAttackOverlay", {}, 0)
        this.player.addAnimation("hideDefendOverlay", {}, 0)
        this.enemyPlayer.addAnimation("hideDefendOverlay", {}, 0)
        let enemyDamage = target.outgoingAttack
        target.takeDamage(this, this.outgoingAttack)
        this.takeDamage(target, enemyDamage)
        this.attacking = false
        this.hasAttacked = true
        if (this.afterAttack) {
            this.afterAttack(target)
        }
        this.player.listenerEmitter.emitPassiveEvent({ monster: this, targetType: "monster", target }, "allyAttacked")
    }
    attackPlayer(target, override) {
        this.updateAttackable()
        if (!override && !this.canAttack) {
            return
        }
        if (!(target.id == this.team && this.ableToAttack.allyPlayer) && !(target.id !== this.team && this.ableToAttack.enemyPlayer)) {
            return
        }
        this.attacking = "player"
        this.player.listenerEmitter.emitPassiveEvent({ monster: this, targetType: "monster", target }, "allyToAttack")
        //display attack markers
        this.player.addDualAnimation("displayAttackOverlay", { ally: true, slot: this.slot }, 0)
        this.player.addDualAnimation("displayAvatarAttacked", { ally: false }, 0)
        //pause
        this.player.addDualAnimation("wait", {}, 400)

        this.player.addDualAnimation("hideAttackOverlay", {}, 0)
        this.player.addDualAnimation("hideAvatarAttacked", { ally: false }, 0)
        target.takeDamage(this, this.outgoingAttack)
        this.attacking = false
        this.hasAttacked = true
        if (this.afterAttack) {
            this.afterAttack(target)
        }
        this.player.listenerEmitter.emitPassiveEvent({ monster: this, targetType: "player", target }, "allyAttacked")
    }
    takeDamage(source, amount) {
        if (this.outgoingKeywords.includes('Armor')) {
            amount -= 1
        }
        if (amount < 0) {
            amount = 0
        }
        this.damage += amount
        if (this.outgoingHP <= 0) {
            this.killerCardID = source.cardID
        }
        this.checkUpdates()
    }
    heal(amount) {
        if (amount <= 0) {
            return
        }
        if (amount > this.damage) {
            amount=this.damage
        }
        this.damage -= amount
        this.checkUpdates()
    }
    checkDeath() {
        if (this.outgoingHP <= 0) {
            this.die()
        }
    }
    checkUpdates() {
        if (this.type == "spell") {
            if (
                this.prevGeoCost != this.outgoingGeoCost ||
                this.prevSoulCost != this.outgoingSoulCost
            ) {
                this.player.addAnimation("updateHandCardData", { pos: this.player.hand.indexOf(this), value: this.getSendableCopy() })
            }
            this.prevGeoCost = this.outgoingGeoCost
            this.prevSoulCost = this.outgoingSoulCost
        } else {
            if (
                this.outgoingHP != this.prevHP ||
                this.outgoingAttack != this.prevAttack ||
                !util.arrsEqual(this.prevKeywords, this.outgoingKeywords) ||
                this.prevGeoCost != this.outgoingGeoCost
            ) {
                console.log("Updated card " + this.name)
                console.log("reason: ")
                switch (true) {
                    case this.outgoingHP != this.prevHP:
                        console.log("HP changed")
                    case this.outgoingAttack != this.prevAttack:
                        if (!(this.outgoingAttack != this.prevAttack)) { break }
                        console.log("Attack changed")
                    case !util.arrsEqual(this.prevKeywords, this.outgoingKeywords):
                        if (util.arrsEqual(this.prevKeywords, this.outgoingKeywords)) { break }
                        console.log("Keywords changed changed")
                    case this.prevGeoCost != this.outgoingGeoCost:
                        if (!(this.prevGeoCost != this.outgoingGeoCost)) { break }
                        console.log("cost changed")
                        break
                    default:
                        console.log("I felt like it.")
                        break
                }
                if (this.zone == "board") {
                    this.player.addAnimation("updateBoardCardData", { ally: true, slot: this.slot, value: this.getSendableCopy() })
                    this.enemyPlayer.addAnimation("updateBoardCardData", { ally: false, slot: this.slot, value: this.getSendableCopy() })
                } else if (this.zone == "hand") {
                    this.player.addAnimation("updateHandCardData", { pos: this.player.hand.indexOf(this), value: this.getSendableCopy() })
                }
            }
            if (this.outgoingHP <= 0) {
                this.die()
            }
            this.prevHP = this.outgoingHP
            this.prevAttack = this.outgoingAttack
            this.prevKeywords = this.outgoingKeywords
            this.prevGeoCost = this.outgoingGeoCost
        }
    }
    die(killer) {
        if (killer && !this.killer) {
            this.killerCardID = killer.cardID
        }
        this.player.slots[this.slot] = null
        this.zone = "death"
        this.player.addDualAnimation("awaitDeath", { ally: true, slot: this.slot }, 300)
        this.listenerEmitter.emitPassiveEvent({}, "triggerDieEvents")
        this.player.listenerEmitter.emitPassiveEvent({card: this}, "allyDied")
    }
    turnStart() {
        this.summoningSick = false
        this.hasAttacked = false;
        if (this.turnStartEffect) {
            this.turnStartEffect(this.game)
        }
    }
    turnEnd() {
        if (this.frozen) {
            this.frozen = false
        }
        if (this.turnEndEffect) {
            this.turnEndEffect(this.game)
        }
    }
    updateAttackable() {
        if (!this.frozen && !this.hasAttacked && !(this.summoningSick && !this.outgoingKeywords.includes("Charge"))) {
            this.canAttack = true
        } else {
            this.canAttack = false
        }
        let tauntCharacters = []
        let allEnemyCharacters = []
        let attackable = {}
        for (let i = 0; i < this.enemyPlayer.slots.length; i++) {
            let character = this.enemyPlayer.slots[i]
            if (character != this && character != null) {
                if (character.outgoingKeywords.includes("Taunt")) {
                    tauntCharacters.push(character)
                }
                allEnemyCharacters.push(character)
            }
        }
        let enemySlots = []
        if (tauntCharacters.length === 0) {
            for (let i = 0; i < allEnemyCharacters.length; i++) {
                enemySlots.push(allEnemyCharacters[i].slot)
            }
            attackable.enemySlots = enemySlots
            attackable.allySlots = []
            attackable.allyPlayer = false
            attackable.enemyPlayer = true
        } else {
            for (let i = 0; i < tauntCharacters.length; i++) {
                enemySlots.push(tauntCharacters[i].slot)
            }
            attackable.enemySlots = enemySlots
            attackable.allySlots = []
            attackable.allyPlayer = false
            attackable.enemyPlayer = false
        }
        this.ableToAttack = attackable
    }
    onSummon(played, target) {
        if (played) {
            this.listenerEmitter.emitPassiveEvent({ target }, "triggerPlayEvents");
        }
    }
    setupSummon(slot) {
        this.slot = slot
        this.zone = "board"
        this.player.addDualAnimation("summonCharacter", { card: this.getSendableCopy(), slot }, 0)
        this.performSetup()
    }
    //Spell only
    // both
    getSendableCopy() {
        this.updateAttackable()
        let curTextSave = this.baseText
        let newText = []
        for (let i = 0; i < this.baseText.length; i++) {
            if (this.baseText[i].type != "evalText" ) {
                newText.push(this.baseText[i])
            } else {
                newText.push(this.baseText[i].value(this))
            }
        }
        this.baseText = newText
        let game = this.game
        this.publicGeoCost = this.outgoingGeoCost
        this.publicSoulCost = this.outgoingSoulCost
        if (this.type == "character") {
            this.publicAttack = this.outgoingAttack
            this.publicHP = this.outgoingHP
            this.publicKeywords = this.outgoingKeywords
            this.actable = this.canAct
        }
        let emitter = this.listenerEmitter
        let receiver = this.listenerReceiver
        this.isCardPlayable = this.isPlayable
        this.game = undefined
        this.listenerEmitter = undefined
        this.listenerReceiver = undefined
        let toReturn = {}
        try {
            toReturn = JSON.parse(JSON.stringify(this))
        } catch (e) {
            console.log(this)
            console.log(e)
        }
        this.baseText = curTextSave
        this.game = game
        this.listenerEmitter = emitter
        this.listenerReceiver = receiver
        this.actable = false
        this.isCardPlayable = null
        this.publicGeoCost = null
        this.publicSoulCost = null
        if (this.type == "character") {
            this.publicHP = null
            this.publicAttack = null
            this.publicKeywords = null
        }
        return toReturn
    }
    loadData(dataToLoad) {
        for (const [key, value] of Object.entries(dataToLoad)) {
            this[key] = value
        }
    }
    removeAllListeners() {
        let eventHandlers = this.listenerReceiver.eventHandlers;
        for (const [key, value] of Object.entries(eventHandlers)) {
            value[1].removeListener(value[0])
        }
        this.listenerReceiver.eventHandlers = {}
    }
    getRandomCards (amount, requirements)  {
        let entries = Object.entries(cardList)
        let possibilities = []
        for (let i = 0; i < entries.length; i++) {
            if (requirements(entries[i][1])) {
                possibilities.push(entries[i][0])
            }
        }
        util.shuffle(possibilities)
        return possibilities.slice(0, amount)
    }
}
module.exports = { Card }
