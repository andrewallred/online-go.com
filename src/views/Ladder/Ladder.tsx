/*
 * Copyright (C) 2012-2017  Online-Go.com
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import * as React from "react";
import {Link} from "react-router-dom";
import {del, get, post, abort_requests_in_flight} from "requests";
import {errorAlerter} from "misc";
import {_, pgettext, interpolate} from "translate";
import {LadderComponent} from "LadderComponent";
import * as data from "data";
import {List, AutoSizer, WindowScroller} from 'react-virtualized';
import {VerticalSlider} from "VerticalSlider";
import {Player} from "Player";
import {UIPush} from "UIPush";
import tooltip from "tooltip";
import {PlayerAutocomplete} from "PlayerAutocomplete";

declare var swal;

interface LadderProperties {
    match: {
        params: any
    };
}

export class Ladder extends React.PureComponent<LadderProperties, any> {
    constructor(props) {
        super(props);
        this.state = {
            ladder_id: this.props.match.params.ladder_id,
            ladder: null,
            ladder_size: 1,
            topVisibleEntry: 0,
            highlight_rank: -1,
            scrollToIndex: undefined,
            invalidationCount: 0,
        };
    }

    componentDidMount() {
        this.resolve(this.props.match.params.ladder_id);
    }

    componentWillReceiveProps(next_props) {
        if (this.props.match.params.ladder_id !== next_props.match.params.ladder_id) {
            this.resolve(next_props.match.params.ladder_id);
        }
    }
    componentDidUpdate(prevProps, prevState) {
        if (this.props.match.params.ladder_id !== prevProps.match.params.ladder_id) {
            this.setState({ladder_id: this.props.match.params.ladder_id});
        }
    }


    resolve(ladder_id) {
        get("ladders/%%", ladder_id)
        .then((ladder) => {
            console.log("Scroll to index: ", ladder.player_rank);
            this.setState({
                ladder: ladder,
                ladder_size: ladder.size,
                highlight_rank: ladder.player_rank > 0 ? ladder.player_rank : -1,
                scrollToIndex: ladder.player_rank > 0 ? ladder.player_rank : undefined,
            });
        })
        .catch(errorAlerter);
    }

    join = () => {
        post("ladders/%%/players", this.props.match.params.ladder_id, {})
        .then(() => {
            this.invalidate();
            this.resolve(this.props.match.params.ladder_id);
        })
        .catch(errorAlerter);
    }

    leave = () => {
        swal({
            "text": _("Are you sure you want to withdraw from the ladder? If you decide to rejoin the ladder in the future you will have to start from the bottom!"),
            "showCancelButton": true,
            "confirmButtonText": _("Yes"),
            "cancelButtonText": _("No"),
            "focusCancel": true
        })
        .then(() => {
            del("ladders/%%/players", this.props.match.params.ladder_id)
            .then(() => {
                this.invalidate();
                this.resolve(this.props.match.params.ladder_id);
            })
            .catch(errorAlerter);
        })
        .catch(() => 0);
    }


    updateAutocompletedPlayer = (user) => {
        if (user) {
            this.setState({ scrollToIndex: Math.max(0, user.ladder_rank - 1), highlight_rank: user.ladder_rank });
        }
    }


    render() {
        let user = data.get("user");

        return (
            <div className="Ladder-container">
            <div className="Ladder">
                <UIPush event="players-updated" channel={`ladder-${this.props.match.params.ladder_id}`} action={this.invalidate} />

                <div className='Ladder-header'>
                    <h2>{this.state.ladder && this.state.ladder.name}</h2>

                    <PlayerAutocomplete ladderId={this.props.match.params.ladder_id} onComplete={this.updateAutocompletedPlayer} />

                    {(this.state.ladder && (!this.state.ladder.group || this.state.ladder.player_is_member_of_group)) &&
                        <span>
                            {(this.state.ladder.player_rank > 0)
                              ? <button onClick={this.leave}>{_("Drop out from ladder")}</button>
                              : <button className="primary" disabled={user.anonymous} onClick={this.join}>{_("Join Ladder")}</button>
                            }
                        </span>
                    }
                </div>

                <div className='AutoSizer-container'>
                    <AutoSizer>
                        {({width, height}) => (
                            <List
                                height={height}
                                width={width}
                                overscanRowCount={20 - (this.state.invalidationCount % 2) /* forces refresh */}
                                rowHeight={120}
                                rowCount={this.state.ladder_size}
                                rowRenderer={this.renderRow}
                                scrollToIndex={this.state.scrollToIndex}
                                />
                        )}
                    </AutoSizer>
                </div>
            </div>
            </div>
        );
    }

    renderRow = ({index, isScrolling, isVisible, key, style}) => {
        return (
            <div className='LadderRow-container' key={key} style={style} >
                <LadderRow
                    index={index}
                    ladder={this}
                    invalidationCount={this.state.invalidationCount}
                    highlightRank={this.state.highlight_rank}
                    isScrolling={isScrolling} />
            </div>
        );
    }

    //let PAGE_SIZE = 20;
    //let ladder_cache:{[ladder_id:number]: {[page_number:number]: any}} = {};

    cache:{[index:number]: any} = {};
    requests_in_flight:{[page_number:number]: Promise<any>} = {};

    invalidate = () => {
        abort_requests_in_flight(`ladders/${this.props.match.params.ladder_id}/players`, 'GET');
        this.requests_in_flight = {};
        this.cache = {};
        this.setState({invalidationCount: this.state.invalidationCount + 1});
    }

    load = (idx:number, only_from_cache:boolean): Promise<any> | any => {
        const PAGE_SIZE = 20;

        if (idx in this.cache) {
            return this.cache[idx];
        }

        if (only_from_cache) {
            return null;
        }


        let page = Math.floor(idx / PAGE_SIZE) + 1;
        if (page in this.requests_in_flight) {
            return this.requests_in_flight[page].then(() => this.cache[idx]);
        }

        this.requests_in_flight[page] = new Promise((resolve, reject) => {
            get(`ladders/${this.props.match.params.ladder_id}/players`, {page, page_size: PAGE_SIZE})
            .then((obj) => {
                delete this.requests_in_flight[page];
                let start = (page - 1) * PAGE_SIZE;

                for (let i = 0; i < obj.results.length; ++i) {
                    this.cache[start + i] = obj.results[i];


                    this.cache[start + i].incoming_challenges = this.cache[start + i].incoming_challenges.sort(by_ladder_rank);
                    this.cache[start + i].outgoing_challenges = this.cache[start + i].outgoing_challenges.sort(by_ladder_rank);
                }

                resolve();
            })
            .catch(() => {
                delete this.requests_in_flight[page];
                reject();
            });
        });

        return this.requests_in_flight[page].then(() => this.cache[idx]);

        function by_ladder_rank(a, b) {
            let ar = a.player.ladder_rank;
            let br = b.player.ladder_rank;
            if (ar < 0) {
                ar = 1000000000;
            }
            if (br < 0) {
                br = 1000000000;
            }
            return ar - br;
        }
    }
}

interface LadderRowProperties {
    index:number;
    isScrolling:boolean;
    highlightRank:number;
    ladder:Ladder;
    invalidationCount:number;
}

export class LadderRow extends React.Component<LadderRowProperties, any> {
    unmounted:boolean = false;

    constructor(props) {
        super(props);
        this.state = null;
        this.sync();
        if (!this.state) {
            this.state = { row: null };
        }
    }

    shouldComponentUpdate(nextProps, nextState) {
        if (!this.state || nextState !== this.state) {
            return true;
        }

        if (nextProps.index !== this.props.index) {
            return true;
        }

        if (this.props.isScrolling !== nextProps.isScrolling) {
            return true;
        }

        if (this.props.highlightRank !== nextProps.highlightRank) {
            return true;
        }

        if (this.props.invalidationCount !== nextProps.invalidationCount) {
            return true;
        }

        return false;
    }

    componentDidUpdate(prevProps, prevState) {
        //console.log("UPdatinged");
        /* TODO: Filtering will need to have another prop available to trigger a reload */
        if (prevProps.index !== this.props.index
            || this.props.isScrolling !== prevProps.isScrolling
            || this.props.invalidationCount !== prevProps.invalidationCount
        ) {
            this.sync();
        }
    }

    componentWillUnmount() {
        this.unmounted = true;
    }

    sync() {
        if (this.props.isScrolling) {
            /* if we're scrolling, only show rows if we have them in cache */
            let obj = this.props.ladder.load(this.props.index, true);
            if (!this.state) {
                this.state = { row: obj };
            }
            else if (obj) {
                if (this.state.row !== obj) {
                    this.setState({row: obj});
                }
            }
        } else {
            /* not scrolling, do actual loading */
            let index = this.props.index;
            let resolve = (obj) => {
                if (this.unmounted || index !== this.props.index) {
                    /* the row we're responsible for rendering has changed, abandon our work */
                    return;
                }

                if (this.state) {
                    this.setState({row: obj});
                } else {
                    this.state = {row: obj};
                }
            };

            let obj_or_promise = this.props.ladder.load(this.props.index, false);

            if (obj_or_promise && obj_or_promise.then) {
                obj_or_promise.then(resolve).catch(() => 0);
            } else {
                resolve(obj_or_promise);
            }
        }
    }

    render() {
        let user = data.get('user');
        let row = this.state.row;
        let challenged_by = row && row.incoming_challenges;
        let challenging = row && row.outgoing_challenges;

        // <b>{_("Challenged by") /* Translators: List of players that challenged this player in a ladder */}: </b>
        // <b>{_("Challenging") /* Translators: List of players that have been challenged by this player in a ladder */}: </b>

        return (
            <div className={'LadderRow' + (row && row.rank === this.props.highlightRank ? ' highlight' : '')}>
                <div className='ladder-player'>
                    <span className='rank'># {(row && row.rank) || (this.props.index + 1)}</span>

                    {row && <Player flag nochallenge user={row.player}/> }

                    {row && !user.anonymous &&
                        <span className='challenge'>
                            {
                                (row.player.id !== user.id && row.can_challenge || null) && ( row.can_challenge.challengeable
                                    ? <button className="primary xs" onClick={this.challenge.bind(this, row)}>{_("Challenge")}</button>
                                    : <span className="not-challengable"
                                          data-title={canChallengeTooltip(row.can_challenge)}
                                          onClick={tooltip}
                                          onMouseOver={tooltip}
                                          onMouseOut={tooltip}
                                          onMouseMove={tooltip}
                                          >{_("Not challengable")}</span>
                                )
                            }
                        </span>
                    }
                </div>

                <div className='challenges'>
                    {((challenging && challenging.length) || null) &&
                        <div className='outgoing'>
                            <span className='arrow'>
                                &rarr;
                            </span>
                            <span className='challenge-list'>
                                {challenging.map((challenge, idx) => (
                                    <Link key={idx} className="challenge-link" to={`/game/${challenge.game_id}`}>
                                        <span className="challenge-rank">#{challenge.player.ladder_rank}</span>
                                        <Player nolink user={challenge.player} />
                                    </Link>
                                ))}
                            </span>
                        </div>
                    }

                    {((challenged_by && challenged_by.length) || null) &&
                        <div className='incoming'>
                            <span className='arrow'>
                                &larr;
                            </span>
                            <span className='challenge-list'>
                                {challenged_by.map((challenge, idx) => (
                                    <Link key={idx} className="challenge-link" to={`/game/${challenge.game_id}`}>
                                        <span className="challenge-rank">#{challenge.player.ladder_rank}</span>
                                        <Player nolink user={challenge.player} />
                                    </Link>
                                ))}
                            </span>
                        </div>
                    }
                </div>
            </div>
        );
    }

    challenge(ladder_player) {
        swal({
            "text": interpolate(_("Are you ready to start your game with {{player_name}}?"), /* translators: ladder challenge */
                         {player_name: ladder_player.player.username}),
            "showCancelButton": true,
            "confirmButtonText": _("Yes!"),
            "cancelButtonText": _("No"),
        })
        .then(() => {
            post("ladders/%%/players/challenge", this.props.ladder.props.match.params.ladder_id, {
                "player_id": ladder_player.player.id,
            })
            .then((res) => {
                this.props.ladder.invalidate();
            })
            .catch(errorAlerter);
        })
        .catch(() => 0);
    }
}

function canChallengeTooltip(obj:any):string {
    if (obj.reason_code) {
        switch (obj.reason_code) {
            case 0x001: return pgettext("Can't challenge player in ladder because: ", "Can't challenge yourself");
            case 0x002: return pgettext("Can't challenge player in ladder because: ", "Player is a lower rank than you");
            case 0x003: return pgettext("Can't challenge player in ladder because: ", "Player is not in the ladder");
            case 0x004: return pgettext("Can't challenge player in ladder because: ", "Player's rank is too high");
            case 0x005: return interpolate(pgettext("Can't challenge player in ladder because: ", "Already playing {{number}} games you've initiated"), {"number": obj.reason_parameter });
            case 0x006: return pgettext("Can't challenge player in ladder because: ", "Already playing a game against this person");
            case 0x007: return pgettext("Can't challenge player in ladder because: ", "Last challenge within 7 days");
            case 0x008: return pgettext("Can't challenge player in ladder because: ", "Player already has the maximum number of challenges");
        }
    }

    if (obj.reason) {
        return obj.reason;
    }

    return null;
}
