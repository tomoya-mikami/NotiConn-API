import { IEventRepository } from "../domain/repository/event";
import { get, post } from 'request-promise';
import * as aws from 'aws-sdk';
import { resolve, reject } from "bluebird";

const paramsToGet = {
    Bucket: process.env.BUCKET,
    Key: process.env.EVENT_FILE,
};

const paramsToPut = {
    Bucket: process.env.BUCKET,
    Key: process.env.EVENT_FILE,
    Body: '',
};

const paramsToPutSinceId = {
    Bucket: process.env.BUCKET,
    Key: process.env.SINCE_ID_FILE,
    Body: '',
};

const paramsToGetSinceId = {
    Bucket: process.env.BUCKET,
    Key: process.env.SINCE_ID_FILE,
};

export class EventRepository extends IEventRepository{
    private s3: aws.S3;
    constructor(s3: aws.S3) {
        super()
        this.s3 = s3;
    }
    async get(req: RegExp): Promise<string> {
        const data = await this.s3.getObject(paramsToGet).promise()
        const formattedData = this.ignoreUnexpectedCharacters(data.Body.toString())
        const events = JSON.parse(formattedData).events
        const filteredEvents = events.filter(event => event.description.match( req ) != null );
        filteredEvents.forEach((e, i) => {
            const topic = e.description.match(req)[0]
            filteredEvents[i].topic = topic
        });
        return JSON.stringify(filteredEvents)
    }

    async save() {
        await this.getConnpassEvent().then(async events => {
            const sinceIdData = await this.s3.getObject(paramsToGetSinceId).promise();
            const sinceIdArray = JSON.parse(sinceIdData.Body.toString());
            const sinceId = sinceIdArray.sinceId || 0;
            let updateSinceId = sinceId;
            const updateEvents = [];
            for (const i in events) {
                if (events[i]['event_id'] > sinceId) {
                    const description: string = events[i]['description'];
                    events[i]['description'] = description
                        .replace(/(https?|ftp)(:\/\/[-_.!~*\'()a-zA-Z0-9;\/?:\@&=+\$,%#]+)/g, "")
                        .replace(/^ [a - zA - Z0 - 9.!#$ %& '*+\/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/g, '');
                    updateEvents.push(events[i]);
                    if (events[i]['event_id'] > updateSinceId) updateSinceId = events[i]['event_id'];
                }
            }
            const updateData = {};
            updateData['events'] = updateEvents;
            paramsToPut['Body'] = JSON.stringify(updateData);
            await this.s3.putObject(paramsToPut, async (err, data) => {
                if (err) {
                    await this.errorLog("data: " + data.toString() + "error: " + err.toString());
                } else {
                    const date = new Date();
                    const options = {
                       year: "numeric",
                       month: "numeric",
                       day: "numeric",
                       hour: "numeric",
                       minute: "numeric",
                       second: "numeric"
                    }
                    const updateAt = date.toLocaleDateString("ja-JP", options);
                    const putData = {
                        sinceId: updateSinceId,
                        updateAt: updateAt,
                    }
                    paramsToPutSinceId['Body'] = JSON.stringify(putData);
                    await this.s3.putObject(paramsToPutSinceId).promise();
                }
            });
            await this.postSlack(paramsToPut['Body']);
        }).catch(err => {
            console.log(err);
        });
    }

    async getConnpassEvent(): Promise<any>{
        const baseUrl: string = "https://connpass.com/api/v1/event"
        const options = {
            uri: baseUrl,
            method: "GET",
            qs: {
                count: 100,
                order: 3
            },
            headers: {
                "User-Agent": "Request-Promise"
            },
            json: true
        };
        return get(options)
            .then(body => {
                return resolve(body["events"]);
            })
            .catch(async e => {
                await this.errorLog(e.toString());
                return reject(e);
            })
    }

    async postSlack(message: string): Promise<any> {
        const hookURL = process.env.HOOKS_URL;
        const options = {
            uri: hookURL,
            method: "POST",
            headers: {
                "User-Agent": "Request-Promise"
            },
            json: {
                "text": message
            }
        };
        return post(options)
            .then(body => {
                return resolve(body);
            })
            .catch(async e => {
                await this.errorLog(e.toString());
                return reject(e);
            })
    }

    async errorLog(err: string) {
        console.error(err)
        return
    }

    ignoreUnexpectedCharacters(str: string): string {
        str = str.replace(/\\n/g, "\\n")
            .replace(/\\'/g, "\\'")
            .replace(/\\"/g, '\\"')
            .replace(/\\&/g, "\\&")
            .replace(/\\r/g, "\\r")
            .replace(/\\t/g, "\\t")
            .replace(/\\b/g, "\\b")
            .replace(/\\f/g, "\\f")
            .replace(/[\u0000-\u0019]+/g, "")
        return str
    }
}
