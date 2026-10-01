FROM grafana/k6:2.3.0

ENV TZ="Europe/London"

USER root

RUN apk add --no-cache aws-cli \
  && mkdir -p /opt/perftest/reports \
  && chown -R k6:k6 /opt/perftest

USER k6

WORKDIR /opt/perftest

COPY --chown=k6:k6 src/ ./src/
COPY --chown=k6:k6 --chmod=755 entrypoint.sh .

ENV S3_ENDPOINT=https://s3.eu-west-2.amazonaws.com

ENTRYPOINT [ "./entrypoint.sh" ]
