#!/bin/sh
# Usage: sample-generator.sh <samples-file> <flag-file>

samples_file=$1
flag_file=$2

quota_cores() {
  if [ -r /sys/fs/cgroup/cpu.max ]; then
    awk '{ if ($1 == "max") print "none"; else print $1 / $2 }' /sys/fs/cgroup/cpu.max
  elif [ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us ] && [ -r /sys/fs/cgroup/cpu/cpu.cfs_period_us ]; then
    quota=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us)
    period=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)
    if [ "$quota" = "-1" ]; then
      echo none
    else
      awk -v q="$quota" -v p="$period" 'BEGIN { print q / p }'
    fi
  else
    echo none
  fi
}

memory_limit() {
  if [ -r /sys/fs/cgroup/memory.max ]; then
    value=$(cat /sys/fs/cgroup/memory.max)
  elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    value=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)
  else
    value=none
  fi

  if [ "$value" = "max" ]; then
    echo none
  else
    echo "$value"
  fi
}

sample() {
  now=$(date +%s)
  cpu=$(awk '/^cpu / {
    busy = $2 + $3 + $4 + $7 + $8 + $9
    total = busy + $5 + $6
    print busy, total
    exit
  }' /proc/stat)
  pid=$(pidof k6 | awk '{ print $1 }')
  k6_cpu=
  k6_rss=

  if [ -n "$pid" ] && [ -r "/proc/$pid/stat" ]; then
    k6_cpu=$(awk '{ print $14 + $15 }' "/proc/$pid/stat")
    k6_rss=$(awk '/^VmRSS/ { print $2 }' "/proc/$pid/status")
  fi

  echo "$now ${cpu:--  -} ${k6_cpu:--} ${k6_rss:--}" >> "$samples_file"
}

{
  echo "# cores $(nproc)"
  echo "# quota_cores $(quota_cores)"
  echo "# clock_ticks $(getconf CLK_TCK 2>/dev/null || echo 100)"
  echo "# memory_limit_bytes $(memory_limit)"
} > "$samples_file"

sample

while [ -f "$flag_file" ]; do
  sleep 5
  sample
done

sample
