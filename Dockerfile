# Builder
FROM node:alpine3.14 as builder

RUN apk add --no-cache bash

RUN mkdir /home/logs
RUN chmod -R 777 /home/logs
RUN touch /home/logs/debug.log


RUN mkdir -p /app
WORKDIR /app

COPY . ./
RUN yarn install

# Runner
FROM node:alpine3.14

USER node

COPY --from=builder /app /app

WORKDIR /app

ENTRYPOINT [ "yarn", "liquidator" ]
